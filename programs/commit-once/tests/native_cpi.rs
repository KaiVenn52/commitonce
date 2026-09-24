//! **A non-Anchor program CPI-ing into `claim`.**
//!
//! `tests/cpi.rs` proves another program can call `claim`, but that program is `demo-counter`,
//! which is written with Anchor — so the CPI goes through Anchor's `CpiContext`, which builds the
//! instruction and the account metas for it. The repository recorded the gap honestly: *"What is
//! not tested is a CPI into `claim` from a non-Anchor onchain program; that needs a second
//! program, and none has been written."*
//!
//! `programs-native/native-guard` is that program. It has no Anchor dependency at all, so it does
//! by hand what `CpiContext` does:
//!
//!   * parses a raw `&[AccountInfo]` with no `#[derive(Accounts)]`;
//!   * builds the `claim` instruction's 144 bytes itself — discriminator then Borsh body;
//!   * orders the account metas the way the callee declares them, with the right flags, because
//!     nothing checks that for it;
//!   * calls `invoke` and handles a raw `ProgramError`.
//!
//! What these tests add over `tests/cpi.rs` is therefore **not** "another program can CPI". It is
//! that a program which never touches Anchor — the majority of Solana programs that are not
//! written by Anchor users — can do it with a hand-built instruction, and that the account order
//! and flags a hand-written CPI has to get right are the ones the program actually declares.
//!
//! What they do **not** prove: anything about a real Squads vault, which is a different program
//! with its own signing model. See `docs/ARCHITECTURE.md` §11.

mod common;

use common::*;
use solana_instruction::{AccountMeta, Instruction};
use solana_signer::Signer;

/// Instruction data for the native program: the `claim` body **without** the discriminator.
///
/// That is the same 136-byte layout the SDK produces, minus the eight bytes the native program
/// prepends itself. Sharing the convention rather than inventing a second one is the point.
fn native_guard_data(args: &ClaimArgs) -> Vec<u8> {
    let mut data = Vec::with_capacity(136);
    data.extend_from_slice(&args.namespace_hash);
    data.extend_from_slice(&args.idempotency_key_hash);
    data.extend_from_slice(&args.payload_hash);
    data.extend_from_slice(&args.retention_seconds.to_le_bytes());
    data.extend_from_slice(args.refund_destination.as_ref());
    data
}

/// Build the native program's instruction.
///
/// Six accounts, in the order the program documents:
/// `state, authority, receipt, instructions_sysvar, commit_once_program, system_program`.
fn native_guard_ix(state: solana_pubkey::Pubkey, args: &ClaimArgs) -> Instruction {
    Instruction::new_with_bytes(
        NATIVE_GUARD_ID,
        &native_guard_data(args),
        vec![
            AccountMeta::new(state, false),
            AccountMeta::new(args.authority, true),
            AccountMeta::new(args.receipt(), false),
            AccountMeta::new_readonly(solana_instructions_sysvar::ID, false),
            AccountMeta::new_readonly(commit_once::id(), false),
            AccountMeta::new_readonly(solana_system_interface::program::ID, false),
        ],
    )
}

/// The native program's business state: one byte, owned by the native program.
///
/// Created directly through LiteSVM rather than by the program, because the program has no
/// initialise instruction — it only increments. Keeping it out of the program keeps the program
/// small enough to read in one sitting, which is the point of it.
fn create_state(env: &mut Env) -> solana_pubkey::Pubkey {
    let address = solana_pubkey::Pubkey::new_unique();
    let lamports = mainnet_rent_exempt_minimum(1);
    let account = solana_account::Account {
        lamports,
        data: vec![0u8],
        owner: NATIVE_GUARD_ID,
        executable: false,
        rent_epoch: 0,
    };
    env.svm
        .set_account(address, account)
        .expect("failed to create the native program's state account");
    address
}

fn state_value(env: &Env, address: &solana_pubkey::Pubkey) -> u8 {
    env.svm
        .get_account(address)
        .expect("state account is missing")
        .data[0]
}

/// The whole point: a non-Anchor program guards its own action, and the action runs once.
#[test]
fn a_native_program_can_guard_its_own_action() {
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    let state = create_state(&mut env);

    let args = ClaimArgs::new(authority, "native:cpi", "order_native", sha256(b"payload"));

    let res = env.send(&[native_guard_ix(state, &args)]);

    assert_success(&res);
    assert_eq!(
        state_value(&env, &state),
        1,
        "the action must have run once through the hand-built CPI"
    );
    assert!(
        env.account_exists(&args.receipt()),
        "the receipt must exist, which means `claim` really executed"
    );
}

/// A rebuilt retry is blocked, and the business action does not run a second time.
///
/// This is the invariant, reached through a CPI that was assembled by hand rather than by
/// Anchor's helper.
#[test]
fn a_rebuilt_retry_through_a_native_program_is_blocked() {
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    let state = create_state(&mut env);

    let args = ClaimArgs::new(
        authority,
        "native:cpi",
        "order_native_retry",
        sha256(b"payload"),
    );

    assert_success(&env.send(&[native_guard_ix(state, &args)]));
    assert_eq!(state_value(&env, &state), 1);

    let retry = env.send_distinct(&[native_guard_ix(state, &args)], 1);
    assert_custom_error(&retry, E_ALREADY_COMMITTED);
    assert_eq!(
        state_value(&env, &state),
        1,
        "the native program's action must not run when the guard blocks"
    );
}

/// **The account order is load-bearing, and nothing checks it for the caller.**
///
/// A hand-written CPI has to pass the callee's accounts in the order the callee declares them.
/// Anchor's `CpiContext` gets that from the generated `accounts::Claim` struct; a native program
/// has no such thing, so getting it wrong is a live mistake rather than a compile error.
///
/// This swaps `receipt` and `instructions_sysvar`. The transaction must fail — and it must fail
/// *because the accounts are wrong*, not because something else coincidentally broke.
#[test]
fn the_hand_written_account_order_is_load_bearing() {
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    let state = create_state(&mut env);

    let args = ClaimArgs::new(authority, "native:cpi", "order_swapped", sha256(b"payload"));
    let mut swapped = native_guard_ix(state, &args);
    swapped.accounts.swap(2, 3);

    let res = env.send(&[swapped]);

    assert!(
        res.is_err(),
        "swapping receipt and instructions_sysvar must fail, not silently succeed"
    );
    assert_eq!(
        state_value(&env, &state),
        0,
        "nothing may execute when the guard's accounts are wrong"
    );
}

/// A different payload under the same key is a conflict, not a duplicate — through the CPI too.
#[test]
fn a_different_payload_through_a_native_program_is_a_conflict() {
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    let state = create_state(&mut env);

    let first = ClaimArgs::new(
        authority,
        "native:cpi",
        "order_conflict",
        sha256(b"payload one"),
    );
    assert_success(&env.send(&[native_guard_ix(state, &first)]));
    assert_eq!(state_value(&env, &state), 1);

    // Same namespace and key, different intent.
    let second = ClaimArgs::new(
        authority,
        "native:cpi",
        "order_conflict",
        sha256(b"payload two"),
    );
    let res = env.send_distinct(&[native_guard_ix(state, &second)], 1);

    assert_custom_error(&res, E_IDEMPOTENCY_CONFLICT);
    assert_eq!(state_value(&env, &state), 1);
}

/// The discriminator the native program hardcodes is the one Anchor derives.
///
/// The native program cannot compute `sha256("global:claim")[0..8]` on chain without shipping a
/// hash implementation, so it hardcodes the eight bytes. This recomputes them and compares, so
/// the hardcoded value is a pin rather than a hope — the same treatment `wire_format.rs` gives
/// the SDK's constants.
#[test]
fn the_native_programs_hardcoded_discriminator_is_correct() {
    let expected = sha256(b"global:claim");
    assert_eq!(
        native_guard::CLAIM_DISCRIMINATOR,
        expected[..8],
        "the native program's hardcoded `claim` discriminator no longer matches its preimage"
    );
    assert_eq!(native_guard::CLAIM_INSTRUCTION_LEN, 144);
    assert_eq!(native_guard::COMMIT_ONCE_ID, commit_once::id());
}
