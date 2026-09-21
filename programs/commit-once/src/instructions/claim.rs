use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke_signed, system_instruction};

use crate::{constants::*, error::CommitOnceError, events::IntentCommitted, state::IntentReceipt};

/// Accounts for `claim`.
///
/// `authority` is declared before `receipt` because the receipt PDA seeds reference it.
#[derive(Accounts)]
#[instruction(namespace_hash: [u8; 32], idempotency_key_hash: [u8; 32])]
pub struct Claim<'info> {
    /// The intent authority. Pays the receipt rent deposit and must sign.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The intent receipt PDA. Created by this instruction when absent.
    ///
    /// CHECK: the address is constrained by the `seeds`/`bump` constraint below, which
    /// binds it to `(RECEIPT_SEED, authority, namespace_hash, idempotency_key_hash)`.
    /// Ownership and discriminator are verified manually in the handler before any
    /// pre-existing account is trusted: `init_if_needed` cannot distinguish "just
    /// created" from "already existed", and that distinction is precisely this
    /// instruction's job.
    #[account(
        mut,
        seeds = [
            RECEIPT_SEED,
            authority.key().as_ref(),
            namespace_hash.as_ref(),
            idempotency_key_hash.as_ref(),
        ],
        bump,
    )]
    pub receipt: UncheckedAccount<'info>,

    /// Instructions sysvar, used to detect durable-nonce transactions.
    ///
    /// CHECK: address-constrained to the Instructions sysvar. The reader below
    /// re-validates the address itself and returns `UnsupportedSysvar` otherwise, so a
    /// substituted account cannot be used to forge a nonce-free reading.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Claim a logical intent.
///
/// Creates the intent receipt PDA when it does not exist. When it does exist this
/// function always fails the transaction — with [`CommitOnceError::AlreadyCommitted`]
/// if the payload fingerprint matches, or [`CommitOnceError::IdempotencyConflict`] if
/// it differs — so that later business instructions in the same transaction never run.
///
/// `namespace_hash` and `idempotency_key_hash` are opaque 32-byte identifiers derived
/// client-side (see the SDK). Hashing off-chain keeps unbounded strings out of the PDA
/// seeds and makes the derivation a single, testable, cross-language definition.
pub fn handle_claim(
    ctx: Context<Claim>,
    namespace_hash: [u8; 32],
    idempotency_key_hash: [u8; 32],
    payload_hash: [u8; 32],
    retention_seconds: u64,
    refund_destination: Pubkey,
) -> Result<()> {
    require!(
        retention_seconds == PERMANENT_RETENTION
            || (retention_seconds >= MIN_RETENTION_SECONDS
                && retention_seconds <= MAX_RETENTION_SECONDS),
        CommitOnceError::InvalidRetention
    );

    let receipt_info = ctx.accounts.receipt.to_account_info();
    let authority_key = ctx.accounts.authority.key();

    require_keys_neq!(
        refund_destination,
        Pubkey::default(),
        CommitOnceError::InvalidRefundDestination
    );
    require_keys_neq!(
        refund_destination,
        receipt_info.key(),
        CommitOnceError::InvalidRefundDestination
    );

    // A durable-nonce transaction has no blockhash expiry, so an old signed duplicate
    // stays executable indefinitely. That is incompatible with a receipt that can later
    // be cleaned up: cleanup would reopen the duplicate window. Permanent receipts have
    // no cleanup path, so they are safe to combine with nonces.
    if retention_seconds != PERMANENT_RETENTION {
        require!(
            !transaction_uses_durable_nonce(&ctx.accounts.instructions_sysvar)?,
            CommitOnceError::DurableNonceUnsupported
        );
    }

    if receipt_info.data_is_empty() {
        return create_receipt(
            ctx.accounts.authority.to_account_info(),
            receipt_info,
            ctx.accounts.system_program.to_account_info(),
            ctx.bumps.receipt,
            authority_key,
            namespace_hash,
            idempotency_key_hash,
            payload_hash,
            retention_seconds,
            refund_destination,
        );
    }

    // The PDA already holds an account. Treat it as an attempted duplicate.
    require_keys_eq!(
        *receipt_info.owner,
        crate::ID,
        CommitOnceError::InvalidReceiptOwner
    );

    let data = receipt_info.try_borrow_data()?;
    let mut slice: &[u8] = &data;
    let receipt = IntentReceipt::try_deserialize(&mut slice)?;
    drop(data);

    require!(
        receipt.version == RECEIPT_VERSION,
        CommitOnceError::UnsupportedReceiptVersion
    );
    // Redundant with the PDA binding, but an explicit check keeps the guarantee legible
    // and defends against any future change to the seed layout.
    require_keys_eq!(
        receipt.authority,
        authority_key,
        CommitOnceError::InvalidReceiptAuthority
    );
    require!(
        receipt.namespace_hash == namespace_hash
            && receipt.idempotency_key_hash == idempotency_key_hash,
        CommitOnceError::InvalidReceiptData
    );

    if receipt.payload_hash == payload_hash {
        msg!(
            "CommitOnce: duplicate intent blocked (already committed at slot {})",
            receipt.created_slot
        );
        return Err(error!(CommitOnceError::AlreadyCommitted));
    }

    msg!("CommitOnce: idempotency conflict - same key, different payload fingerprint");
    Err(error!(CommitOnceError::IdempotencyConflict))
}

#[allow(clippy::too_many_arguments)]
fn create_receipt<'info>(
    authority_info: AccountInfo<'info>,
    receipt_info: AccountInfo<'info>,
    system_program_info: AccountInfo<'info>,
    bump: u8,
    authority: Pubkey,
    namespace_hash: [u8; 32],
    idempotency_key_hash: [u8; 32],
    payload_hash: [u8; 32],
    retention_seconds: u64,
    refund_destination: Pubkey,
) -> Result<()> {
    let clock = Clock::get()?;
    let space = IntentReceipt::LEN;
    let lamports = Rent::get()?.minimum_balance(space);

    let seeds: &[&[u8]] = &[
        RECEIPT_SEED,
        authority.as_ref(),
        namespace_hash.as_ref(),
        idempotency_key_hash.as_ref(),
        &[bump],
    ];

    invoke_signed(
        &system_instruction::create_account(
            &authority,
            receipt_info.key,
            lamports,
            space as u64,
            &crate::ID,
        ),
        &[authority_info, receipt_info.clone(), system_program_info],
        &[seeds],
    )?;

    let (expires_at_slot, expires_at_unix_ts) = if retention_seconds == PERMANENT_RETENTION {
        (0u64, 0i64)
    } else {
        (
            clock
                .slot
                .saturating_add(retention_seconds.saturating_mul(SLOTS_PER_SECOND)),
            clock.unix_timestamp.saturating_add(retention_seconds as i64),
        )
    };

    let receipt = IntentReceipt {
        version: RECEIPT_VERSION,
        bump,
        authority,
        namespace_hash,
        idempotency_key_hash,
        payload_hash,
        refund_destination,
        created_slot: clock.slot,
        expires_at_slot,
        created_unix_ts: clock.unix_timestamp,
        expires_at_unix_ts,
    };

    {
        let mut data = receipt_info.try_borrow_mut_data()?;
        let mut cursor = std::io::Cursor::new(&mut data[..]);
        receipt.try_serialize(&mut cursor)?;
    }

    emit!(IntentCommitted {
        authority,
        namespace_hash,
        idempotency_key_hash,
        payload_hash,
        refund_destination,
        created_slot: receipt.created_slot,
        expires_at_slot: receipt.expires_at_slot,
        created_unix_ts: receipt.created_unix_ts,
        expires_at_unix_ts: receipt.expires_at_unix_ts,
    });

    Ok(())
}

/// Returns `true` when the enclosing transaction carries durable-nonce semantics.
///
/// A durable-nonce transaction must include a System Program `AdvanceNonceAccount`
/// instruction. Because a signature covers the whole message, an already-signed
/// durable-nonce transaction can never have that instruction stripped, so its presence
/// is a reliable indicator. We scan every instruction in the transaction rather than
/// only the first, which is deliberately stricter than strictly necessary.
///
/// The conceptual approach is borrowed from audited open-source prior art (Squads
/// `nonce-guard`); this implementation is written and tested independently.
fn transaction_uses_durable_nonce(instructions_sysvar: &AccountInfo) -> Result<bool> {
    for index in 0..MAX_INSTRUCTION_SCAN {
        match solana_instructions_sysvar::load_instruction_at_checked(index, instructions_sysvar) {
            Ok(instruction) => {
                if instruction.program_id == anchor_lang::system_program::ID
                    && instruction.data.len() >= 4
                    && u32::from_le_bytes([
                        instruction.data[0],
                        instruction.data[1],
                        instruction.data[2],
                        instruction.data[3],
                    ]) == ADVANCE_NONCE_ACCOUNT_DISCRIMINATOR
                {
                    return Ok(true);
                }
            }
            // Ran past the end of the transaction's instruction list.
            Err(_) => return Ok(false),
        }
    }
    Ok(false)
}
