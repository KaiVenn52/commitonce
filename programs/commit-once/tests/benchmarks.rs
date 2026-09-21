//! Measured overhead of the CommitOnce guard.
//!
//! These figures back the numbers quoted in `README.md`, `docs/` and the submission
//! package, so every one of them is produced by executing the real compiled program rather
//! than estimated. Run with output visible:
//!
//! ```bash
//! bash scripts/test.sh --test benchmarks -- --nocapture
//! ```
//!
//! Two categories of number appear below, and the distinction is kept explicit:
//!
//! * **Measured** — compute units, lamport balances and account data lengths, all read back
//!   from the LiteSVM execution result or the account store.
//! * **Computed** — transaction wire size. LiteSVM does not report the serialized size, so
//!   it is computed from the legacy message wire format. The formula is deterministic and
//!   written out in [`legacy_wire_size`] so it can be checked by hand.

mod common;

use common::*;
use litesvm::types::TransactionResult;
use solana_hash::Hash;
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;

/// Length of a Solana shortvec-encoded length prefix.
fn shortvec_len(value: usize) -> usize {
    match value {
        0..=127 => 1,
        128..=16_383 => 2,
        _ => 3,
    }
}

/// Exact serialized size of a legacy (non-versioned) transaction.
///
/// Layout: `shortvec(signature_count) ‖ signatures ‖ header(3) ‖ shortvec(account_count) ‖
/// account_keys ‖ blockhash ‖ shortvec(instruction_count) ‖ instructions`, where each
/// instruction is `program_id_index(1) ‖ shortvec(account_count) ‖ account_indices ‖
/// shortvec(data_len) ‖ data`.
///
/// Signatures are always 64 bytes, and every transaction here has exactly one signer.
fn legacy_wire_size(ixs: &[Instruction], payer: &Pubkey, blockhash: &Hash) -> usize {
    let message = solana_message::Message::new_with_blockhash(ixs, Some(payer), blockhash);

    let mut size = shortvec_len(1) + 64; // one signature
    size += 3; // num_required_signatures, num_readonly_signed, num_readonly_unsigned
    size += shortvec_len(message.account_keys.len());
    size += 32 * message.account_keys.len();
    size += 32; // recent blockhash
    size += shortvec_len(ixs.len());
    for ix in ixs {
        size += 1; // program_id_index
        size += shortvec_len(ix.accounts.len());
        size += 32 * ix.accounts.len();
        size += shortvec_len(ix.data.len());
        size += ix.data.len();
    }
    size
}

fn account_count(ixs: &[Instruction], payer: &Pubkey, blockhash: &Hash) -> usize {
    solana_message::Message::new_with_blockhash(ixs, Some(payer), blockhash)
        .account_keys
        .len()
}

/// Compute units consumed by a transaction, whether it succeeded or failed. The runtime
/// charges for work performed up to the point of failure, so both are meaningful.
fn cu_of(result: &TransactionResult) -> u64 {
    match result {
        Ok(meta) => meta.compute_units_consumed,
        Err(failed) => failed.meta.compute_units_consumed,
    }
}

/// Measure the receipt rent deposit by actually reading it off chain state, rather than
/// trusting the constant.
fn measured_receipt_deposit(env: &mut Env, claim: &ClaimArgs) -> (u64, usize) {
    let authority = env.authority_pubkey();
    let before = env.lamports(&authority);

    let meta = match env.send(&[claim.instruction()]) {
        Ok(meta) => meta,
        Err(failed) => panic!("claim failed: {:?}\n{}", failed.err, failed.meta.pretty_logs()),
    };

    let after = env.lamports(&authority);
    let account = env.svm.get_account(&claim.receipt()).expect("receipt exists");

    // The authority pays both the deposit and the transaction fee, so the account balance
    // alone would conflate the two. Assert the decomposition instead of assuming it.
    assert_eq!(
        before - after,
        account.lamports + meta.fee,
        "authority delta should be exactly deposit + fee"
    );

    (account.lamports, account.data.len())
}

#[test]
fn guard_overhead_is_measured() {
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    let blockhash = env.svm.latest_blockhash();

    // ------------------------------------------------------------------
    // Baseline: the business action with no guard at all.
    // ------------------------------------------------------------------
    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let bare = [increment_ix(authority)];
    let bare_cu = assert_success(&env.send(&bare));
    let bare_size = legacy_wire_size(&bare, &authority, &blockhash);
    let bare_accounts = account_count(&bare, &authority, &blockhash);

    // ------------------------------------------------------------------
    // Guarded: claim + the same business action, first attempt.
    // ------------------------------------------------------------------
    let claim = ClaimArgs::new(authority, "bench", "order-1", sha256(b"payload"))
        .retention(MIN_RETENTION);
    let guarded = [claim.instruction(), increment_ix(authority)];
    let guarded_cu = assert_success(&env.send(&guarded));
    let guarded_size = legacy_wire_size(&guarded, &authority, &blockhash);
    let guarded_accounts = account_count(&guarded, &authority, &blockhash);

    // ------------------------------------------------------------------
    // Duplicate: same intent, rebuilt, rejected. This is the cost a caller pays when the
    // guard fires — it is the common path during an ambiguous-timeout retry.
    // ------------------------------------------------------------------
    let dup = env.send_distinct(&guarded, 7);
    assert_custom_error(&dup, E_ALREADY_COMMITTED);
    let duplicate_cu = cu_of(&dup);

    // ------------------------------------------------------------------
    // Claim on its own, so the guard's own cost can be separated from the business action.
    // ------------------------------------------------------------------
    let solo = ClaimArgs::new(authority, "bench", "order-solo", sha256(b"payload"))
        .retention(MIN_RETENTION);
    let solo_cu = assert_success(&env.send(&[solo.instruction()]));

    // ------------------------------------------------------------------
    // Cleanup, which refunds the deposit.
    // ------------------------------------------------------------------
    env.advance(MAX_RETENTION * 4, (MAX_RETENTION as i64) + 60);
    let close = close_receipt_ix(claim.receipt(), authority);
    let close_cu = assert_success(&env.send(&[close]));

    // ------------------------------------------------------------------
    // Deposit and account size, read from the account store.
    // ------------------------------------------------------------------
    let deposit_claim = ClaimArgs::new(authority, "bench", "deposit", sha256(b"p"))
        .retention(MIN_RETENTION);
    let (deposit, receipt_len) = measured_receipt_deposit(&mut env, &deposit_claim);

    // ------------------------------------------------------------------
    // Report.
    // ------------------------------------------------------------------
    println!("\n================ CommitOnce guard overhead ================");
    println!("\n-- Compute units (measured) --");
    println!("  business action alone .............. {bare_cu:>7}");
    println!("  claim alone ........................ {solo_cu:>7}");
    println!("  claim + business action (first) .... {guarded_cu:>7}");
    println!("  duplicate blocked (rebuild) ........ {duplicate_cu:>7}");
    println!("  close_receipt (cleanup) ............ {close_cu:>7}");
    println!("  guard delta vs bare ................ {:>7}", guarded_cu as i64 - bare_cu as i64);

    println!("\n-- Transaction wire size, legacy format (computed from the wire layout) --");
    println!("  business action alone .............. {bare_size:>7} bytes, {bare_accounts} accounts");
    println!("  claim + business action ............ {guarded_size:>7} bytes, {guarded_accounts} accounts");
    println!(
        "  guard delta ........................ {:>7} bytes, {} accounts",
        guarded_size as i64 - bare_size as i64,
        guarded_accounts as i64 - bare_accounts as i64
    );

    println!("\n-- Receipt account (measured) --");
    println!("  data length ........................ {receipt_len:>7} bytes");
    println!("  rent deposit ....................... {deposit:>7} lamports");
    println!("  rent deposit ....................... {:>7.7} SOL", deposit as f64 / 1e9);
    println!("  mainnet rate applied ............... {:>7} lamports/byte", MAINNET_LAMPORTS_PER_BYTE);

    println!("\n-- Instruction data (measured) --");
    println!("  claim data length .................. {:>7} bytes", claim.instruction().data.len());
    println!("  claim accounts ..................... {:>7}", claim.instruction().accounts.len());

    println!("\n===========================================================\n");

    // Sanity assertions so the reported numbers cannot silently drift.
    assert_eq!(receipt_len, 202, "receipt account size changed");
    assert_eq!(deposit, RECEIPT_RENT_LAMPORTS, "receipt rent deposit changed");
    assert_eq!(claim.instruction().data.len(), 144, "claim instruction size changed");
    assert!(guarded_cu > bare_cu, "guard should cost more than the bare action");
    assert!(
        guarded_accounts > bare_accounts,
        "guard should add at least one account"
    );
}
