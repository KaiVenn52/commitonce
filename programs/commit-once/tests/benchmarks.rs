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
//! Three categories of number appear below, and the distinction is kept explicit:
//!
//! * **Measured, deterministic** — account data lengths, lamport balances, instruction data
//!   length and account count. These are read back from the account store or the instruction
//!   itself and are identical on every run, so they are asserted exactly.
//! * **Computed** — transaction wire size. LiteSVM does not report the serialized size, so it
//!   is computed from the legacy message wire format. The formula is deterministic and written
//!   out in [`legacy_wire_size`] so it can be checked by hand.
//! * **Measured, non-deterministic** — compute units.
//!
//! ## Why compute units are reported as a spread
//!
//! LiteSVM's compute accounting is *not* reproducible run to run for the same transaction. The
//! same unmodified test binary, executing the same byte-identical `.so`, has been observed to
//! report a bare counter increment at **5,567**, **7,067** and **19,067** CU across three
//! consecutive runs, and the guard delta between **8,337** and **9,837**.
//!
//! Quoting a single figure from that distribution would be fabricated precision — and worse, a
//! reader could not reproduce it. So each compute-unit figure below is measured across
//! [`RUNS`] independent [`Env`] instances and reported as min / median / max. The structural
//! numbers, which are exact, carry the weight; the compute units are reported honestly as the
//! noisy quantity they are.
//!
//! The practical consequence for a reader: use the *spread* to size a compute budget, and take
//! the upper end. The account and byte counts, which are what actually determine the rent
//! deposit and the wire cost, are exact.

mod common;

use common::*;
use litesvm::types::TransactionResult;
use solana_hash::Hash;
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;

/// Number of independent environments each compute-unit figure is measured across.
const RUNS: usize = 9;

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

/// A compute-unit measurement across several independent runs.
#[derive(Debug, Clone, Copy)]
struct Spread {
    min: u64,
    median: u64,
    max: u64,
}

impl Spread {
    fn of(mut values: Vec<u64>) -> Self {
        assert!(!values.is_empty(), "no measurements");
        values.sort_unstable();
        Spread {
            min: values[0],
            median: values[values.len() / 2],
            max: values[values.len() - 1],
        }
    }

    /// How far the extremes sit either side of the median, as a percentage of the median.
    fn spread_percent(&self) -> f64 {
        if self.median == 0 {
            return 0.0;
        }
        (self.max - self.min) as f64 * 100.0 / self.median as f64
    }

    fn render(&self) -> String {
        format!(
            "{:>7} / {:>7} / {:>7}   (±{:.0}%)",
            self.min,
            self.median,
            self.max,
            self.spread_percent() / 2.0
        )
    }
}

/// Run a scenario in [`RUNS`] fresh environments and collect the compute units each time.
///
/// A fresh [`Env`] per run is deliberate: the point is to sample the distribution that a reader
/// would actually observe, not to measure one warmed-up environment.
fn measure<F>(mut scenario: F) -> Spread
where
    F: FnMut(&mut Env) -> u64,
{
    let mut values = Vec::with_capacity(RUNS);
    for _ in 0..RUNS {
        let mut env = Env::new();
        values.push(scenario(&mut env));
    }
    Spread::of(values)
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
    // ------------------------------------------------------------------
    // Baseline: the business action with no guard at all.
    // ------------------------------------------------------------------
    let bare = measure(|env| {
        let authority = env.authority_pubkey();
        assert_success(&env.send(&[initialize_counter_ix(authority)]));
        assert_success(&env.send(&[increment_ix(authority)]))
    });

    // ------------------------------------------------------------------
    // Guarded: claim + the same business action, first attempt.
    // ------------------------------------------------------------------
    let guarded = measure(|env| {
        let authority = env.authority_pubkey();
        assert_success(&env.send(&[initialize_counter_ix(authority)]));
        let claim = ClaimArgs::new(authority, "bench", "order-1", sha256(b"payload"))
            .retention(MIN_RETENTION);
        assert_success(&env.send(&[claim.instruction(), increment_ix(authority)]))
    });

    // ------------------------------------------------------------------
    // Duplicate: same intent, rebuilt, rejected. This is the cost a caller pays when the
    // guard fires — the common path during an ambiguous-timeout retry.
    // ------------------------------------------------------------------
    let duplicate = measure(|env| {
        let authority = env.authority_pubkey();
        assert_success(&env.send(&[initialize_counter_ix(authority)]));
        let claim = ClaimArgs::new(authority, "bench", "order-dup", sha256(b"payload"))
            .retention(MIN_RETENTION);
        let guarded = [claim.instruction(), increment_ix(authority)];
        assert_success(&env.send(&guarded));
        let dup = env.send_distinct(&guarded, 7);
        assert_custom_error(&dup, E_ALREADY_COMMITTED);
        cu_of(&dup)
    });

    // ------------------------------------------------------------------
    // Claim on its own, so the guard's own cost can be separated from the business action.
    // ------------------------------------------------------------------
    let solo = measure(|env| {
        let authority = env.authority_pubkey();
        let claim = ClaimArgs::new(authority, "bench", "order-solo", sha256(b"payload"))
            .retention(MIN_RETENTION);
        assert_success(&env.send(&[claim.instruction()]))
    });

    // ------------------------------------------------------------------
    // Cleanup, which refunds the deposit.
    // ------------------------------------------------------------------
    let close = measure(|env| {
        let authority = env.authority_pubkey();
        let claim = ClaimArgs::new(authority, "bench", "order-close", sha256(b"payload"))
            .retention(MIN_RETENTION);
        assert_success(&env.send(&[claim.instruction()]));
        env.advance(MAX_RETENTION * 4, (MAX_RETENTION as i64) + 60);
        assert_success(&env.send(&[close_receipt_ix(claim.receipt(), authority)]))
    });

    // ------------------------------------------------------------------
    // Structural numbers, which are exact and therefore measured once.
    // ------------------------------------------------------------------
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    let blockhash = env.svm.latest_blockhash();

    let claim = ClaimArgs::new(authority, "bench", "order-1", sha256(b"payload"))
        .retention(MIN_RETENTION);
    let bare_ixs = [increment_ix(authority)];
    let guarded_ixs = [claim.instruction(), increment_ix(authority)];

    let bare_size = legacy_wire_size(&bare_ixs, &authority, &blockhash);
    let bare_accounts = account_count(&bare_ixs, &authority, &blockhash);
    let guarded_size = legacy_wire_size(&guarded_ixs, &authority, &blockhash);
    let guarded_accounts = account_count(&guarded_ixs, &authority, &blockhash);

    let deposit_claim = ClaimArgs::new(authority, "bench", "deposit", sha256(b"p"))
        .retention(MIN_RETENTION);
    let (deposit, receipt_len) = measured_receipt_deposit(&mut env, &deposit_claim);

    // ------------------------------------------------------------------
    // Report.
    // ------------------------------------------------------------------
    println!("\n================ CommitOnce guard overhead ================");

    println!("\n-- Compute units: min / median / max over {RUNS} fresh environments --");
    println!("   (LiteSVM's compute accounting is not reproducible run to run; see the module docs)");
    println!("  business action alone .............. {}", bare.render());
    println!("  claim alone ........................ {}", solo.render());
    println!("  claim + business action (first) .... {}", guarded.render());
    println!("  duplicate blocked (rebuild) ........ {}", duplicate.render());
    println!("  close_receipt (cleanup) ............ {}", close.render());
    println!(
        "  guard delta vs bare (medians) ...... {:>7}",
        guarded.median as i64 - bare.median as i64
    );

    println!("\n-- Transaction wire size, legacy format (computed from the wire layout; exact) --");
    println!("  business action alone .............. {bare_size:>7} bytes, {bare_accounts} accounts");
    println!("  claim + business action ............ {guarded_size:>7} bytes, {guarded_accounts} accounts");
    println!(
        "  guard delta ........................ {:>7} bytes, {} accounts",
        guarded_size as i64 - bare_size as i64,
        guarded_accounts as i64 - bare_accounts as i64
    );

    println!("\n-- Receipt account (measured; exact) --");
    println!("  data length ........................ {receipt_len:>7} bytes");
    println!("  rent deposit ....................... {deposit:>7} lamports");
    println!("  rent deposit ....................... {:>7.7} SOL", deposit as f64 / 1e9);
    println!("  mainnet rate applied ............... {:>7} lamports/byte", MAINNET_LAMPORTS_PER_BYTE);

    println!("\n-- Instruction data (measured; exact) --");
    println!("  claim data length .................. {:>7} bytes", claim.instruction().data.len());
    println!("  claim accounts ..................... {:>7}", claim.instruction().accounts.len());

    println!("\n===========================================================\n");

    // Structural assertions: these are exact, so drift must fail the suite.
    assert_eq!(receipt_len, 202, "receipt account size changed");
    assert_eq!(deposit, RECEIPT_RENT_LAMPORTS, "receipt rent deposit changed");
    assert_eq!(claim.instruction().data.len(), 144, "claim instruction size changed");
    assert_eq!(bare_size, 273, "bare wire size changed");
    assert_eq!(guarded_size, 677, "guarded wire size changed");
    assert_eq!(bare_accounts, 3, "bare account count changed");
    assert_eq!(guarded_accounts, 7, "guarded account count changed");

    // Compute units are noisy, so the assertion is on the ordering that must hold, not on a
    // specific value. Asserting an exact figure here would make the suite flaky and would
    // assert something that is not a property of the program.
    assert!(
        guarded.median > bare.median,
        "the guard should cost more than the bare action: guarded median {} vs bare median {}",
        guarded.median,
        bare.median
    );
    assert!(
        duplicate.median > bare.median,
        "a blocked duplicate still does work, so it should cost more than the bare action"
    );
    assert!(
        solo.median > 0 && close.median > 0,
        "claim and close_receipt should both consume compute units"
    );
}
