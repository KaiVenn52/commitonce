//! A **native** Solana program — no Anchor — that guards its own action with CommitOnce.
//!
//! # Why this exists
//!
//! `tests/cpi.rs` proves that another program can call `commit_once::claim` through a CPI, and
//! `demo-counter` is that program. But `demo-counter` is an **Anchor** program, so the CPI goes
//! through Anchor's `CpiContext`, which builds the instruction and the account metas for it.
//!
//! The repository recorded the consequence honestly: *"What is not tested is a CPI into `claim`
//! from a non-Anchor onchain program; that needs a second program, and none has been written."*
//!
//! This is that program. It has no Anchor dependency at all, so it has to do by hand what
//! `CpiContext` does:
//!
//!   * parse the account list out of a raw `&[AccountInfo]` with no `#[derive(Accounts)]`;
//!   * build the `claim` instruction's **144 bytes** itself — the 8-byte discriminator followed
//!     by the Borsh body — rather than asking a generated client for them;
//!   * pass the account metas in the order the callee expects, with the right signer and
//!     writable flags, since nothing checks that for it;
//!   * `invoke` the CPI and handle a raw `ProgramError`.
//!
//! # The account order is the point
//!
//! `claim` takes its accounts in the order `authority, receipt, instructions_sysvar,
//! system_program`. A caller that gets that wrong gets a confusing failure from inside the
//! callee rather than a compile error, which is exactly the class of mistake a hand-written CPI
//! is prone to. Building it here and asserting it in `tests/native_cpi.rs` is the evidence.
//!
//! # What it proves, and what it does not
//!
//! It proves the guard is callable from a program that does not use Anchor, which is most of the
//! Solana programs that are not written by Anchor users. It does **not** prove anything about a
//! real Squads vault, which is a different program with its own signing model.

use solana_account_info::AccountInfo;
use solana_cpi::invoke;
use solana_instruction::{AccountMeta, Instruction};
use solana_program_error::{ProgramError, ProgramResult};
use solana_pubkey::Pubkey;

/// The CommitOnce program. Same address on every cluster; see `deploy-keys/`.
pub const COMMIT_ONCE_ID: Pubkey = Pubkey::new_from_array([
    0xae, 0x20, 0x15, 0xb2, 0xf9, 0x23, 0xb1, 0xdd, 0x71, 0xd4, 0xb2, 0xd0, 0xad, 0x65, 0x9e, 0xc7,
    0xb6, 0x39, 0xd2, 0x8e, 0x2f, 0x17, 0x1f, 0xed, 0x82, 0xf4, 0x2f, 0x9c, 0xec, 0xc9, 0xc9, 0x80,
]);

/// `sha256("global:claim")[0..8]`.
///
/// Hardcoded for the same reason the SDK hardcodes it: computing it on chain would mean shipping
/// a SHA-256 implementation for eight bytes. `tests/native_cpi.rs` recomputes it and fails if the
/// two disagree, so this is a pin rather than a hope.
pub const CLAIM_DISCRIMINATOR: [u8; 8] = [62, 198, 214, 193, 213, 159, 108, 210];

/// Byte length of a `claim` instruction: 8 discriminator + 32 + 32 + 32 + 8 + 32.
pub const CLAIM_INSTRUCTION_LEN: usize = 144;

/// Accounts this program's instruction expects, in order.
pub const ACCOUNT_COUNT: usize = 6;

/// Errors this program can return.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum NativeGuardError {
    /// Fewer than [`ACCOUNT_COUNT`] accounts were passed.
    NotEnoughAccounts = 1,
    /// The instruction data is not exactly [`CLAIM_INSTRUCTION_LEN`] bytes.
    WrongInstructionLength = 2,
    /// The account at index 3 is not the Instructions sysvar.
    WrongInstructionsSysvar = 4,
    /// The account at index 4 is not the CommitOnce program.
    WrongCommitOnceProgram = 5,
    /// The state account is not owned by this program.
    WrongStateOwner = 6,
    /// The state account has no data to increment.
    EmptyState = 7,
}

impl From<NativeGuardError> for ProgramError {
    fn from(error: NativeGuardError) -> Self {
        ProgramError::Custom(error as u32)
    }
}

/// Build the `claim` CPI instruction.
///
/// The body is Borsh, in field-declaration order:
///
/// ```text
/// namespace_hash      [u8; 32]
/// idempotency_key_hash [u8; 32]
/// payload_hash        [u8; 32]
/// retention_seconds   u64 little-endian
/// refund_destination  Pubkey
/// ```
///
/// `refund_destination` is passed as an argument rather than taken from the account list, because
/// it is not one: the program records it and pays it later.
pub fn build_claim_instruction(
    accounts: &[AccountInfo],
    data: &[u8],
) -> Result<Instruction, ProgramError> {
    if accounts.len() < ACCOUNT_COUNT {
        return Err(NativeGuardError::NotEnoughAccounts.into());
    }
    if data.len() != CLAIM_INSTRUCTION_LEN {
        return Err(NativeGuardError::WrongInstructionLength.into());
    }

    let authority = &accounts[1];
    let receipt = &accounts[2];
    let instructions_sysvar = &accounts[3];
    let commit_once_program = &accounts[4];
    let system_program = &accounts[5];

    // Constrained here rather than trusted: `claim` re-checks both, but failing in the caller
    // gives a clearer error and proves this program is not passing arbitrary accounts through.
    if instructions_sysvar.key != &solana_instructions_sysvar_id() {
        return Err(NativeGuardError::WrongInstructionsSysvar.into());
    }
    if commit_once_program.key != &COMMIT_ONCE_ID {
        return Err(NativeGuardError::WrongCommitOnceProgram.into());
    }

    // The instruction data is the callee's, byte for byte: discriminator then the 136-byte body.
    let mut instruction_data = Vec::with_capacity(CLAIM_INSTRUCTION_LEN);
    instruction_data.extend_from_slice(&CLAIM_DISCRIMINATOR);
    instruction_data.extend_from_slice(&data[8..]);

    Ok(Instruction {
        program_id: COMMIT_ONCE_ID,
        // Order matters and nothing checks it for us. This is the order `Claim` declares:
        // authority, receipt, instructions_sysvar, system_program.
        accounts: vec![
            AccountMeta::new(*authority.key, true),
            AccountMeta::new(*receipt.key, false),
            AccountMeta::new_readonly(*instructions_sysvar.key, false),
            AccountMeta::new_readonly(*system_program.key, false),
        ],
        data: instruction_data,
    })
}

/// The Instructions sysvar address, as a `Pubkey`.
///
/// Spelled out rather than imported so this program depends on nothing it does not need; the
/// value is the well-known `Sysvar1nstructions1111111111111111111111111`.
fn solana_instructions_sysvar_id() -> Pubkey {
    Pubkey::new_from_array([
        0x06, 0xa7, 0xd5, 0x17, 0x18, 0x7b, 0xd1, 0x66, 0x35, 0xda, 0xd4, 0x04, 0x55, 0xfd, 0xc2,
        0xc0, 0xc1, 0x24, 0xc6, 0x8f, 0x21, 0x56, 0x75, 0xa5, 0xdb, 0xba, 0xcb, 0x5f, 0x08, 0x00,
        0x00, 0x00,
    ])
}

/// The program's entrypoint.
///
/// Six accounts, in order:
///
/// | # | Account | Flags |
/// | --- | --- | --- |
/// | 0 | `state` | writable, owned by this program |
/// | 1 | `authority` | **signer**, writable — pays the receipt deposit |
/// | 2 | `receipt` | writable — the CommitOnce receipt PDA |
/// | 3 | `instructions_sysvar` | read-only |
/// | 4 | `commit_once_program` | read-only |
/// | 5 | `system_program` | read-only |
///
/// Instruction data: `namespace_hash || idempotency_key_hash || payload_hash ||
/// retention_seconds (u64 LE) || refund_destination`, i.e. the `claim` body **without** the
/// discriminator. That is 136 bytes; the discriminator is prepended by
/// [`build_claim_instruction`], which is what makes this program's wire format a subset of the
/// SDK's rather than a second convention.
pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let state = accounts
        .first()
        .ok_or(NativeGuardError::NotEnoughAccounts)?;
    if state.owner != _program_id {
        return Err(NativeGuardError::WrongStateOwner.into());
    }

    // The action and the guard are in one instruction, so if `claim` returns `AlreadyCommitted`
    // this whole transaction reverts and the increment below never happens. That is the property
    // being demonstrated: atomicity is the runtime's, not this program's.
    // The caller passes the 136-byte body without the discriminator, so this program and the SDK
    // share one wire convention rather than inventing a second. Assembled into a local array
    // that lives for the whole instruction.
    if data.len() != CLAIM_INSTRUCTION_LEN - 8 {
        return Err(NativeGuardError::WrongInstructionLength.into());
    }
    let mut full = [0u8; CLAIM_INSTRUCTION_LEN];
    full[..8].copy_from_slice(&CLAIM_DISCRIMINATOR);
    full[8..].copy_from_slice(data);

    let claim = build_claim_instruction(accounts, &full)?;

    invoke(
        &claim,
        &[
            accounts[1].clone(),
            accounts[2].clone(),
            accounts[3].clone(),
            accounts[5].clone(),
            accounts[4].clone(),
        ],
    )?;

    // The business action, after the guard has committed. Reached only if the CPI succeeded.
    let mut state_data = state.try_borrow_mut_data()?;
    let counter = state_data.first_mut().ok_or(NativeGuardError::EmptyState)?;
    *counter = counter
        .checked_add(1)
        .ok_or(ProgramError::InvalidAccountData)?;

    Ok(())
}

#[cfg(not(feature = "no-entrypoint"))]
solana_program_entrypoint::entrypoint!(process_instruction);
