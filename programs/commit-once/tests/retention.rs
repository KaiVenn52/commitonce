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
    assert!(stored.is_permanent(), "retention 0 must produce a permanent receipt");
    assert_eq!(stored.expires_at_slot, 0);
    assert_eq!(stored.expires_at_unix_ts, 0);
}

/// The slot deadline must be derived from the *current* mainnet slot rate (4/second),
/// not the historical 400ms assumption. Underestimating it would silently shorten the
/// advertised window.
#[test]
fn slot_deadline_uses_current_mainnet_slot_rate() {
    let (mut env, claim, _) = claim_with_retention(MIN_RETENTION);
    assert_success(&env.send(&[claim.instruction()]));
    let stored = env.read_receipt(&claim.receipt());
    assert_eq!(
        stored.expires_at_slot,
        stored.created_slot + MIN_RETENTION * 4,
        "slot deadline must assume 250ms slots (4 per second)"
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
    assert_custom_error(&env.send_distinct(&[close.clone()], 0), E_RECEIPT_NOT_EXPIRED);
    assert!(env.account_exists(&receipt), "receipt must survive a rejected close");

    // Wall clock not yet reached, slot deadline already past: must still fail.
    env.set_slot(stored.expires_at_slot + 10_000);
    env.set_unix_timestamp(stored.expires_at_unix_ts - 1);
    assert_custom_error(&env.send_distinct(&[close.clone()], 1), E_RECEIPT_NOT_EXPIRED);
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
    assert_custom_error(&env.send(&[close_receipt_ix(receipt, refund.pubkey())]), E_RECEIPT_IS_PERMANENT);
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
    assert!(res.is_err(), "close must not redirect the deposit to an arbitrary account");
    assert!(env.account_exists(&receipt));

    // The legitimate destination still works.
    assert_success(&env.send(&[close_receipt_ix(receipt, refund.pubkey())]));
    assert!(!env.account_exists(&receipt));
}
