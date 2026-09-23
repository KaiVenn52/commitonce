//! CPI: another program calling `claim` itself.
//!
//! Every other test in this suite uses the **client-side** pattern — the caller prepends
//! `claim` to the transaction it builds. This file tests the other one, and it was the last
//! documented gap in the composability story: `docs/FAQ.md` said a PDA authority "works only if
//! a program signs for it through CPI", and then admitted that **there was no such integration
//! in the repository and no test for it**.
//!
//! That matters for a concrete reason rather than for completeness. A PDA cannot sign for
//! itself, so the client-side pattern cannot use one — which means a Squads vault, or any other
//! program-owned account, can only be an authority through a CPI. Several documents said "a
//! Squads vault can act as the authority" without that caveat; this file is what makes the
//! mechanism true rather than assumed.
//!
//! The program under test is `demo-counter`, which now has an `increment_guarded` instruction:
//! it calls `commit_once::claim` and then increments, in the same instruction. The property
//! being tested is the same one the whole product rests on, just reached differently — if
//! `claim` fails, the increment must not happen and the transaction must revert.

mod common;

use common::*;

/// The CPI path commits, and the business action runs exactly once.
#[test]
fn a_program_can_call_claim_through_cpi() {
    banner("cpi: another program calls claim, and the action runs once");
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let claim = ClaimArgs::new(authority, "cpi:demo", "order_1", sha256(b"payload"));

    // One instruction, no client-side guard: `increment_guarded` does both.
    let res = env.send(&[increment_guarded_ix(&claim)]);

    assert_success(&res);
    assert_eq!(env.counter_value(&authority), 1);
    assert!(
        env.account_exists(&claim.receipt()),
        "the receipt must exist, or the guard did not actually run"
    );
}

/// The invariant holds through the CPI too: a rebuilt retry is blocked and the counter stays
/// at one.
///
/// This is the load-bearing test of the file. Without it, "the CPI commits" would only show
/// that the call succeeds once — it would say nothing about the second attempt, which is the
/// entire point of the product.
#[test]
fn a_rebuilt_retry_through_cpi_is_blocked() {
    banner("cpi: a rebuilt retry is blocked, and the action does not run twice");
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let claim = ClaimArgs::new(authority, "cpi:demo", "order_retry", sha256(b"payload"));

    assert_success(&env.send(&[increment_guarded_ix(&claim)]));
    assert_eq!(env.counter_value(&authority), 1);

    // A rebuilt retry: `send_distinct` prepends a different compute-unit price, so the message
    // bytes and therefore the signature differ. The runtime's message-hash deduplication does
    // not apply, so only the guard can stop this.
    let retry = env.send_distinct(&[increment_guarded_ix(&claim)], 1);

    assert_custom_error(&retry, E_ALREADY_COMMITTED);
    assert_eq!(
        env.counter_value(&authority),
        1,
        "the retry must not have incremented the counter a second time"
    );
}

/// A different payload under the same key is a conflict, not a duplicate — through the CPI.
///
/// The distinction is the difference between "your action already happened, stop" and "this key
/// belongs to a different action, and something is wrong". A caller that cannot tell them apart
/// will do the wrong thing on a retry.
#[test]
fn a_different_payload_through_cpi_is_a_conflict_not_a_duplicate() {
    banner("cpi: same key, different payload is a conflict");
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let first = ClaimArgs::new(
        authority,
        "cpi:demo",
        "order_conflict",
        sha256(b"payload A"),
    );
    assert_success(&env.send(&[increment_guarded_ix(&first)]));
    assert_eq!(env.counter_value(&authority), 1);

    let second = ClaimArgs::new(
        authority,
        "cpi:demo",
        "order_conflict",
        sha256(b"payload B"),
    );
    let res = env.send_distinct(&[increment_guarded_ix(&second)], 1);

    assert_custom_error(&res, E_IDEMPOTENCY_CONFLICT);
    assert_eq!(env.counter_value(&authority), 1);
}

/// The guard's accounts cannot be substituted by the calling program.
///
/// `increment_guarded` constrains `commit_once_program` to `commit_once::id()`, so a caller
/// cannot point the "guard" at a program of their choosing and have the counter increment while
/// the guard is something else. This asserts that constraint is actually enforced rather than
/// merely declared.
#[test]
fn the_cpi_guard_program_cannot_be_substituted() {
    banner("cpi: the guard program address cannot be substituted");
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let claim = ClaimArgs::new(authority, "cpi:demo", "order_sub", sha256(b"payload"));

    // Same instruction, but the commit_once_program account is replaced by the counter program.
    let mut substituted = increment_guarded_ix(&claim);
    substituted.accounts[4] = solana_instruction::AccountMeta::new_readonly(DEMO_COUNTER_ID, false);

    let res = env.send(&[substituted]);
    assert!(
        res.is_err(),
        "pointing the guard at a different program must fail, not silently succeed"
    );
    assert_eq!(
        env.counter_value(&authority),
        0,
        "the counter must not have advanced when the guard account was wrong"
    );
}
