//! Retention, expiry and cleanup semantics.
//!
//! The guarantee CommitOnce makes is bounded by a retention window, so the *window* is
//! part of the security surface, not an implementation detail. These tests pin down:
//!
//! * the accepted range of retention values,
//! * that cleanup requires **both** the monotonic slot deadline and the wall-clock
//!   deadline to have passed,
//! * that cleanup returns the rent deposit to the configured destination, and
//! * that cleanup deliberately reopens the key — which is what makes the window a real
//!   trade-off rather than a free lunch.

mod common;

use common::*;
use solana_signer::Signer;

fn claim_with_retention(retention_seconds: u64) -> (Env, ClaimArgs, solana_keypair::Keypair) {
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    let refund = env.fresh_funded(1);
    let claim = ClaimArgs::new(authority, "retention", "k", sha256(b"payload"))
        .retention(retention_seconds)
        .refund_to(refund.pubkey());
    (env, claim, refund)
}

#[test]
fn retention_below_minimum_is_rejected() {
    for retention in [1u64, 60, MIN_RETENTION - 1] {
        let (mut env, claim, _) = claim_with_retention(retention);
        let res = env.send(&[claim.instruction()]);
        assert_custom_error(&res, E_INVALID_RETENTION);
        assert!(
            !env.account_exists(&claim.receipt()),
            "a rejected claim must not create a receipt (retention={retention})"
        );
    }
}

#[test]
fn retention_above_maximum_is_rejected() {
    for retention in [MAX_RETENTION + 1, MAX_RETENTION * 2, u64::MAX] {
        let (mut env, claim, _) = claim_with_retention(retention);
        let res = env.send(&[claim.instruction()]);
        assert_custom_error(&res, E_INVALID_RETENTION);
        assert!(!env.account_exists(&claim.receipt()));
    }
}

#[test]
fn retention_boundaries_are_accepted() {
    // Exactly the minimum.
    let (mut env, claim, _) = claim_with_retention(MIN_RETENTION);
    assert_success(&env.send(&[claim.instruction()]));
    assert!(env.account_exists(&claim.receipt()));

    // Exactly the maximum.
    let (mut env, claim, _) = claim_with_retention(MAX_RETENTION);
    assert_success(&env.send(&[claim.instruction()]));
    let stored = env.read_receipt(&claim.receipt());
    assert_eq!(
        stored.expires_at_unix_ts,
        stored.created_unix_ts + MAX_RETENTION as i64
    );

    // Zero means permanent.
    let (mut env, claim, _) = claim_with_retention(0);
    assert_success(&env.send(&[claim.instruction()]));
    let stored = env.read_receipt(&claim.receipt());
    assert!(
        stored.is_permanent(),
        "retention 0 must produce a permanent receipt"
    );
    assert_eq!(stored.expires_at_slot, 0);
    assert_eq!(stored.expires_at_unix_ts, 0);
}

/// The slot deadline must be derived from `SLOTS_PER_SECOND`, and that constant must be at or
/// above mainnet's real rate.
///
/// Mainnet measures **3.77 slots/second** (265 ms) and devnet **6.09** (164 ms), sampled live by
/// `apps/demo/slot-rate.ts`. The constant is `4`: above mainnet's real rate, so the slot gate
/// lands *later* than the wall-clock gate there and cleanup is delayed rather than early.
///
/// The direction does not actually decide the window, because `close_receipt` requires both
/// gates — the effective deadline is the later of the two. An earlier version of this comment
/// said underestimating the constant "would silently shorten the advertised window", which is
/// false for exactly that reason, and contradicted `receipt_cannot_be_closed_before_expiry`,
/// which is the test that proves it.
#[test]
fn slot_deadline_uses_current_mainnet_slot_rate() {
    let (mut env, claim, _) = claim_with_retention(MIN_RETENTION);
    assert_success(&env.send(&[claim.instruction()]));
    let stored = env.read_receipt(&claim.receipt());
    assert_eq!(
        stored.expires_at_slot,
        stored.created_slot + MIN_RETENTION * 4,
        "slot deadline must assume 4 slots per second, the value SLOTS_PER_SECOND pins"
    );
}

#[test]
fn receipt_cannot_be_closed_before_expiry() {
    let (mut env, claim, refund) = claim_with_retention(MIN_RETENTION);
    let authority = env.authority_pubkey();
    assert_success(&env.send(&[claim.instruction()]));

    let receipt = claim.receipt();
    let stored = env.read_receipt(&receipt);
    let close = close_receipt_ix(receipt, refund.pubkey());

    // Slot deadline not yet reached, wall clock already past: must still fail.
    env.set_slot(stored.expires_at_slot - 1);
    env.set_unix_timestamp(stored.expires_at_unix_ts + 10_000);
    assert_custom_error(
        &env.send_distinct(&[close.clone()], 0),
        E_RECEIPT_NOT_EXPIRED,
    );
    assert!(
        env.account_exists(&receipt),
        "receipt must survive a rejected close"
    );

    // Wall clock not yet reached, slot deadline already past: must still fail.
    env.set_slot(stored.expires_at_slot + 10_000);
    env.set_unix_timestamp(stored.expires_at_unix_ts - 1);
    assert_custom_error(
        &env.send_distinct(&[close.clone()], 1),
        E_RECEIPT_NOT_EXPIRED,
    );
    assert!(env.account_exists(&receipt));

    // Both gates passed: closes.
    env.set_slot(stored.expires_at_slot);
    env.set_unix_timestamp(stored.expires_at_unix_ts);
    assert_success(&env.send_distinct(&[close], 2));
    assert!(!env.account_exists(&receipt), "receipt must be closed");
    let _ = authority;
}

#[test]
fn close_returns_rent_deposit_to_the_configured_destination() {
    let (mut env, claim, refund) = claim_with_retention(MIN_RETENTION);
    assert_success(&env.send(&[claim.instruction()]));

    let receipt = claim.receipt();
    let stored = env.read_receipt(&receipt);

    let deposited = env.lamports(&receipt);
    assert_eq!(
        deposited,
        mainnet_rent_exempt_minimum(commit_once::state::IntentReceipt::LEN as u64),
        "the receipt must hold exactly the mainnet rent-exempt minimum"
    );

    let before = env.lamports(&refund.pubkey());

    env.set_slot(stored.expires_at_slot);
    env.set_unix_timestamp(stored.expires_at_unix_ts);
    assert_success(&env.send(&[close_receipt_ix(receipt, refund.pubkey())]));

    assert_eq!(
        env.lamports(&refund.pubkey()) - before,
        deposited,
        "the full rent deposit must be refunded to the configured destination"
    );
}

/// Closing a receipt frees the key. This is the documented cost of a bounded window: the
/// guarantee holds for the retention period, and after cleanup the intent may be claimed
/// again. The window is therefore a deliberate trade-off, not an oversight.
#[test]
fn closing_frees_the_key_for_a_new_claim() {
    let (mut env, claim, refund) = claim_with_retention(MIN_RETENTION);
    let authority = env.authority_pubkey();
    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    assert_success(&env.send(&[claim.instruction(), increment_ix(authority)]));
    let res = env.send_distinct(&[claim.instruction(), increment_ix(authority)], 1);
    assert_custom_error(&res, E_ALREADY_COMMITTED);
    assert_eq!(env.counter_value(&authority), 1);

    let receipt = claim.receipt();
    let stored = env.read_receipt(&receipt);
    env.set_slot(stored.expires_at_slot);
    env.set_unix_timestamp(stored.expires_at_unix_ts);
    assert_success(&env.send(&[close_receipt_ix(receipt, refund.pubkey())]));

    // The same intent can now be claimed again. Documented, tested, intentional: the
    // guarantee is bounded by the retention window, and cleanup ends it.
    assert_success(&env.send_distinct(&[claim.instruction(), increment_ix(authority)], 2));
    assert_eq!(env.counter_value(&authority), 2);
}

#[test]
fn permanent_receipt_cannot_be_closed() {
    let (mut env, claim, refund) = claim_with_retention(0);
    assert_success(&env.send(&[claim.instruction()]));

    let receipt = claim.receipt();

    // Warp absurdly far into the future: a permanent receipt still must not close.
    env.set_slot(10_000_000_000);
    env.set_unix_timestamp(4_000_000_000);
    assert_custom_error(
        &env.send(&[close_receipt_ix(receipt, refund.pubkey())]),
        E_RECEIPT_IS_PERMANENT,
    );
    assert!(env.account_exists(&receipt));
}

#[test]
fn close_requires_the_configured_refund_destination() {
    let (mut env, claim, refund) = claim_with_retention(MIN_RETENTION);
    assert_success(&env.send(&[claim.instruction()]));

    let receipt = claim.receipt();
    let stored = env.read_receipt(&receipt);
    env.set_slot(stored.expires_at_slot);
    env.set_unix_timestamp(stored.expires_at_unix_ts);

    // Any account other than the recorded refund destination must be refused.
    let attacker = env.fresh_funded(1);
    let res = env.send(&[close_receipt_ix(receipt, attacker.pubkey())]);
    assert!(
        res.is_err(),
        "close must not redirect the deposit to an arbitrary account"
    );
    assert!(env.account_exists(&receipt));

    // The legitimate destination still works.
    assert_success(&env.send(&[close_receipt_ix(receipt, refund.pubkey())]));
    assert!(!env.account_exists(&receipt));
}

/// **Cleanup is permissionless, and the deposit still goes to the configured destination.**
///
/// `close_receipt` has no authority constraint, and the documentation says so: *"Permissionless:
/// anyone may call this, because the destination cannot be redirected."* The test above checks
/// the second half — that a caller cannot redirect the deposit — but every successful close in
/// this suite is submitted by the authority, so the first half was never actually exercised.
///
/// The distinction matters. If close silently required the authority, cleanup would be blocked
/// exactly when it is most needed: a key that was rotated, a team that lost the key, or a receipt
/// whose authority no longer exists. The window would stay open and the deposit would stay
/// stranded, and nothing in the suite would have noticed.
#[test]
fn cleanup_is_permissionless() {
    let (mut env, claim, refund) = claim_with_retention(MIN_RETENTION);
    assert_success(&env.send(&[claim.instruction()]));

    let receipt = claim.receipt();
    let stored = env.read_receipt(&receipt);
    env.set_slot(stored.expires_at_slot);
    env.set_unix_timestamp(stored.expires_at_unix_ts);

    // A third party with no relationship to the intent.
    let stranger = env.fresh_funded(1);
    let refund_before = env.lamports(&refund.pubkey());

    // Submitted by the stranger, not by the authority.
    assert_success(&env.send_as(
        &stranger,
        &[close_receipt_ix(receipt, refund.pubkey())],
        &[],
    ));

    assert!(
        !env.account_exists(&receipt),
        "a third party must be able to close an expired receipt"
    );

    // And the deposit went to the configured destination, not to the caller. The stranger paid
    // the fee, so the destination's balance should rise by the deposit and no more.
    let refund_after = env.lamports(&refund.pubkey());
    assert_eq!(
        refund_after - refund_before,
        RECEIPT_RENT_LAMPORTS,
        "the deposit must reach the configured destination even when a stranger triggers cleanup"
    );
}
