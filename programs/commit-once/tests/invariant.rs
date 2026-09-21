//! The core CommitOnce invariant, tested against the real compiled program.
//!
//! > For one `(authority, namespace, idempotency_key)` tuple, no more than one guarded
//! > transaction may successfully commit during the receipt retention period.
//!
//! Every assertion here is made against **observable onchain state** — the value of a
//! counter owned by a separate program that knows nothing about CommitOnce, and the
//! existence of the receipt account. No test asserts on an error string.

mod common;

use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

/// The canonical failure scenario, without protection: two independently built and
/// signed transactions representing the same logical action both execute.
///
/// This is the "before" half of the A/B demo, and it is the reason CommitOnce exists.
///
/// Note on sequencing: LiteSVM accepts exactly one recent blockhash at a time, so the two
/// attempts cannot both be in flight. They are therefore built and submitted in sequence,
/// each against the blockhash that was current when it was built — which is precisely what
/// a client does when it loses a response and rebuilds.
#[test]
fn without_guard_two_rebuilt_transactions_execute_twice() {
    banner("baseline: no guard, rebuilt retry executes twice");
    let mut env = Env::new();
    let authority = env.authority_pubkey();

    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let blockhash_a = env.svm.latest_blockhash();
    let tx_a = env.build(&[increment_ix(authority)], &[], blockhash_a);
    let sig_a = tx_a.signatures[0];
    assert_success(&env.svm.send_transaction(tx_a));
    assert_eq!(env.counter_value(&authority), 1);

    // The client "loses" the response and rebuilds against a fresh blockhash.
    env.svm.expire_blockhash();
    let blockhash_b = env.svm.latest_blockhash();
    assert_ne!(
        blockhash_a, blockhash_b,
        "the retry must be built on a different blockhash"
    );

    let tx_b = env.build(&[increment_ix(authority)], &[], blockhash_b);
    assert_ne!(
        sig_a, tx_b.signatures[0],
        "different message bytes must produce different signatures"
    );

    assert_success(&env.svm.send_transaction(tx_b));
    assert_eq!(
        env.counter_value(&authority),
        2,
        "WITHOUT the guard the same logical action executes twice"
    );
}

/// The "after" half: the same scenario, with one guard instruction prepended to each
/// attempt. The first commits, the retry is aborted, and the business action runs once.
#[test]
fn with_guard_rebuilt_retry_is_blocked_and_business_action_runs_once() {
    banner("invariant: rebuilt retry blocked by CommitOnce");
    let mut env = Env::new();
    let authority = env.authority_pubkey();

    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let claim = ClaimArgs::new(
        authority,
        "demo:counter",
        "order_928",
        sha256(b"increment counter by 1"),
    );
    let receipt = claim.receipt();
    let guarded = [claim.instruction(), increment_ix(authority)];

    let blockhash_a = env.svm.latest_blockhash();
    let tx_a = env.build(&guarded, &[], blockhash_a);
    let sig_a = tx_a.signatures[0];

    let meta_a = env.svm.send_transaction(tx_a).expect("first attempt must succeed");
    assert_eq!(meta_a.signature, sig_a);
    assert_eq!(env.counter_value(&authority), 1, "business action ran once");
    assert!(env.account_exists(&receipt), "receipt must exist after commit");

    // Same fault injection as the baseline test: response lost, fresh blockhash.
    env.svm.expire_blockhash();
    let blockhash_b = env.svm.latest_blockhash();
    assert_ne!(blockhash_a, blockhash_b);

    let tx_b = env.build(&guarded, &[], blockhash_b);
    assert_ne!(
        sig_a, tx_b.signatures[0],
        "the retry is a genuinely different signed transaction, not a rebroadcast"
    );

    let res_b = env.svm.send_transaction(tx_b);
    assert_custom_error(&res_b, E_ALREADY_COMMITTED);
    assert_eq!(
        env.counter_value(&authority),
        1,
        "the guarded business action must NOT run a second time"
    );

    // The receipt is unchanged and still describes the original commitment.
    let stored = env.read_receipt(&receipt);
    assert_eq!(stored.authority, authority);
    assert_eq!(stored.payload_hash, claim.payload_hash);
    assert_eq!(stored.created_slot, env.clock().slot);
    assert!(
        stored.expires_at_slot > stored.created_slot,
        "a 24h receipt must expire strictly after it was created"
    );
}

/// Atomicity: if any instruction after the guard fails, the whole transaction is rolled
/// back and the receipt must not exist. There is no window where a receipt exists
/// without its business action having committed.
#[test]
fn downstream_failure_rolls_back_the_receipt() {
    banner("atomicity: downstream failure removes the receipt");
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    let stranger = env.stranger.pubkey();

    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let claim = ClaimArgs::new(
        authority,
        "demo:counter",
        "rollback_case",
        sha256(b"increment counter by 1"),
    );
    let receipt = claim.receipt();

    let before = env.lamports(&authority);

    // The transfer cannot succeed: it exceeds the authority's balance.
    let doomed_transfer = transfer_ix(authority, stranger, 1_000_000 * LAMPORTS_PER_SOL);
    let res = env.send(&[claim.instruction(), increment_ix(authority), doomed_transfer]);
    let failed = match res {
        Ok(_) => panic!("the transaction must fail"),
        Err(failed) => failed,
    };

    assert!(
        !env.account_exists(&receipt),
        "receipt must be rolled back when a later instruction fails"
    );
    assert_eq!(
        env.counter_value(&authority),
        0,
        "the business action must also be rolled back"
    );

    // The transaction fee is charged even for a failed transaction, so it is not part of
    // the rollback. Everything else must be: the rent deposit has to come back, otherwise
    // a failed attempt would silently burn rent on every retry.
    let fee = failed.meta.fee;
    assert!(fee > 0, "a failed transaction should still have paid a fee");
    assert_eq!(
        env.lamports(&authority),
        before - fee,
        "only the transaction fee may be spent; the rent deposit must be rolled back"
    );

    // Because the receipt was rolled back, the intent is claimable again — which is the
    // correct semantics: nothing committed, so nothing is protected yet.
    let retry = env.send(&[claim.instruction(), increment_ix(authority)]);
    assert_success(&retry);
    assert_eq!(env.counter_value(&authority), 1);
    assert!(env.account_exists(&receipt));
}

/// Reusing a key with a *different* payload fingerprint is a conflict, not a duplicate.
/// This is the `order_928 / 10 USDC` vs `order_928 / 100 USDC` case.
#[test]
fn same_key_different_payload_is_an_idempotency_conflict() {
    banner("conflict: same key, different payload fingerprint");
    let mut env = Env::new();
    let authority = env.authority_pubkey();

    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let first = ClaimArgs::new(authority, "payments:transfer", "order_928", sha256(b"send 10 USDC to Alice"));
    let receipt = first.receipt();
    assert_success(&env.send(&[first.instruction(), increment_ix(authority)]));
    assert_eq!(env.counter_value(&authority), 1);

    let second = ClaimArgs::new(authority, "payments:transfer", "order_928", sha256(b"send 100 USDC to Bob"));
    assert_eq!(second.receipt(), receipt, "same key resolves to the same receipt");

    let res = env.send(&[second.instruction(), increment_ix(authority)]);
    assert_custom_error(&res, E_IDEMPOTENCY_CONFLICT);
    assert_eq!(env.counter_value(&authority), 1);

    // The original fingerprint is preserved; a conflict never overwrites it.
    assert_eq!(
        env.read_receipt(&receipt).payload_hash,
        first.payload_hash,
        "the first accepted fingerprint must be immutable"
    );

    // And the original intent still resolves as an ordinary duplicate. The blockhash is
    // expired first so that this is a genuine rebuild rather than a byte-identical
    // rebroadcast, which the runtime's status cache would reject with `AlreadyProcessed`
    // before CommitOnce ever saw it.
    env.svm.expire_blockhash();
    let res = env.send(&[first.instruction(), increment_ix(authority)]);
    assert_custom_error(&res, E_ALREADY_COMMITTED);
}

/// Two different idempotency keys are two different intents and must both execute.
#[test]
fn different_keys_both_execute() {
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    for key in ["order_1", "order_2"] {
        let claim = ClaimArgs::new(authority, "demo:counter", key, sha256(b"increment"));
        assert_success(&env.send(&[claim.instruction(), increment_ix(authority)]));
    }
    assert_eq!(env.counter_value(&authority), 2);
}

/// Two different authorities may use the same textual key without colliding, and neither
/// can block the other. This is the property that makes third-party squatting impossible.
#[test]
fn same_textual_key_under_different_authorities_does_not_collide() {
    banner("scoping: authority is part of the receipt identity");
    let mut env = Env::new();
    let authority = env.authority_pubkey();

    let other = env.fresh_funded(10);
    let other_pubkey = other.pubkey();

    assert_success(&env.send(&[initialize_counter_ix(authority)]));
    // The counter's owner must sign, so this one is submitted by `other`.
    assert_success(&env.send_as(&other, &[initialize_counter_ix(other_pubkey)], &[]));

    let payload = sha256(b"increment");

    let mine = ClaimArgs::new(authority, "shared:namespace", "order_928", payload);
    let theirs = ClaimArgs::new(other_pubkey, "shared:namespace", "order_928", payload);

    assert_ne!(
        mine.receipt(),
        theirs.receipt(),
        "the same textual key under different authorities must derive different receipts"
    );

    assert_success(&env.send(&[mine.instruction(), increment_ix(authority)]));
    // A different authority reusing the identical textual key is not blocked.
    assert_success(&env.send_as(&other, &[theirs.instruction(), increment_ix(other_pubkey)], &[]));

    assert_eq!(env.counter_value(&authority), 1);
    assert_eq!(env.counter_value(&other_pubkey), 1);
}

/// Two different applications may use the same textual key without colliding.
#[test]
fn same_textual_key_under_different_namespaces_does_not_collide() {
    banner("scoping: namespace is part of the receipt identity");
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let payload = sha256(b"increment");
    let swap = ClaimArgs::new(authority, "app_a:swap", "order_928", payload);
    let mint = ClaimArgs::new(authority, "app_b:mint", "order_928", payload);

    assert_ne!(
        swap.receipt(),
        mint.receipt(),
        "the same textual key under different namespaces must derive different receipts"
    );

    assert_success(&env.send(&[swap.instruction(), increment_ix(authority)]));
    assert_success(&env.send(&[mint.instruction(), increment_ix(authority)]));
    assert_eq!(env.counter_value(&authority), 2);
}

/// The first successful claim binds the receipt; every subsequent attempt with the same
/// identity fails before its business instruction can run.
#[test]
fn only_the_first_of_many_attempts_commits() {
    banner("race: N in-flight attempts, exactly one business execution");
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let claim = ClaimArgs::new(authority, "demo:counter", "race_key", sha256(b"increment"));

    // Model N clients that each built and signed their attempt before any of them landed.
    // They share the current blockhash (LiteSVM accepts only one recent blockhash at a
    // time) but each sets a different priority fee, which is the most common way a rebuilt
    // attempt differs from its predecessor. Every attempt is therefore a distinct,
    // independently valid transaction carrying the same logical intent.
    let blockhash = env.svm.latest_blockhash();
    let mut attempts = Vec::new();
    for bump in 0..5u64 {
        attempts.push(env.build(
            &[
                set_compute_unit_price_ix(1_000 + bump),
                claim.instruction(),
                increment_ix(authority),
            ],
            &[],
            blockhash,
        ));
    }

    let mut signatures = std::collections::HashSet::new();
    for tx in &attempts {
        signatures.insert(tx.signatures[0]);
    }
    assert_eq!(signatures.len(), attempts.len(), "every attempt is a distinct signed transaction");

    let mut successes = 0usize;
    for tx in attempts {
        if env.svm.send_transaction(tx).is_ok() {
            successes += 1;
        }
    }

    assert_eq!(successes, 1, "exactly one attempt may commit");
    assert_eq!(
        env.counter_value(&authority),
        1,
        "the business action must execute exactly once"
    );
}

/// Normal Solana behaviour for identical signed bytes is unchanged: rebroadcasting the
/// same transaction is still rejected by the runtime's status cache. CommitOnce does not
/// interfere with, or replace, that layer.
#[test]
fn identical_rebroadcast_still_rejected_by_the_runtime() {
    banner("compatibility: identical rebroadcast is still deduplicated by the runtime");
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let claim = ClaimArgs::new(authority, "demo:counter", "rebroadcast", sha256(b"increment"));
    let blockhash = env.svm.latest_blockhash();
    let tx = env.build(&[claim.instruction(), increment_ix(authority)], &[], blockhash);

    // Byte-for-byte identical: same message, same signature. This is what a client that
    // correctly re-submits the *same* transaction does.
    let rebroadcast = tx.clone();
    assert_eq!(tx.signatures[0], rebroadcast.signatures[0]);

    assert_success(&env.svm.send_transaction(tx));
    assert_eq!(env.counter_value(&authority), 1);

    let res = env.svm.send_transaction(rebroadcast);
    match res {
        Err(failed) => assert_eq!(
            failed.err,
            solana_transaction_error::TransactionError::AlreadyProcessed,
            "an identical rebroadcast must still be deduplicated by the runtime"
        ),
        Ok(_) => panic!("identical rebroadcast unexpectedly executed twice"),
    }
    assert_eq!(env.counter_value(&authority), 1);
}

/// The guard must not be a no-op for the business action: after a successful claim the
/// remaining instructions run normally and produce their normal effect.
#[test]
fn guard_is_transparent_to_the_business_instructions() {
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    let recipient = Keypair::new().pubkey();
    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let claim = ClaimArgs::new(authority, "transparent", "k1", sha256(b"transfer"));
    let before = env.lamports(&recipient);

    assert_success(&env.send(&[
        claim.instruction(),
        increment_ix(authority),
        transfer_ix(authority, recipient, 5_000_000),
    ]));

    assert_eq!(env.counter_value(&authority), 1);
    assert_eq!(env.lamports(&recipient) - before, 5_000_000);
}
