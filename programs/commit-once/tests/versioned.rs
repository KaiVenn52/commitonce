//! v0 messages with address lookup tables.
//!
//! Every other test in this suite builds `VersionedMessage::Legacy`. Production clients
//! mostly do not: **v0 with an address lookup table** is how a transaction still fits inside
//! the 1232-byte packet limit once it touches more than a handful of accounts, and it is the
//! default for anything built by a modern SDK.
//!
//! Whether the guard survives that shape is a genuine compatibility question rather than a
//! formality, for two reasons:
//!
//!   1. `claim` reads the **Instructions sysvar**. That read is by transaction index, not by
//!      account, so it should be indifferent to how accounts were resolved — but "should be"
//!      is not evidence.
//!   2. A lookup table **cannot supply a signer**. The authority is a signer and must stay in
//!      the static keys, while the receipt PDA, the Instructions sysvar and the System
//!      Program can all be loaded from a table. If the guard depended on any of those being
//!      statically present, this is where it would show.
//!
//! The suite previously recorded this as "expected to work, but not verified". These tests
//! are what turns that into a result.

mod common;

use anchor_lang::pubkey;
use common::*;
use solana_message::{v0, AddressLookupTableAccount};

/// The guard commits normally when its non-signer accounts arrive through a lookup table.
#[test]
fn guarded_transaction_commits_in_a_v0_message_with_a_lookup_table() {
    banner("v0: the guard commits when its accounts come from a lookup table");
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let claim = ClaimArgs::new(authority, "ns", "v0_commit", sha256(b"payload"));

    // Everything except the signer can be loaded from the table.
    let looked_up = vec![
        claim.receipt(),
        pubkey!("Sysvar1nstructions1111111111111111111111111"),
        pubkey!("11111111111111111111111111111111"),
        counter_pda(&authority),
        pubkey!("EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5"),
    ];
    let table = env.create_lookup_table(&looked_up);

    let res = env.send_v0(&[claim.instruction(), increment_ix(authority)], table, &looked_up);

    assert_success(&res);
    assert_eq!(env.counter_value(&authority), 1);
    assert!(env.account_exists(&claim.receipt()));
}

/// The invariant holds in v0 form: a rebuilt retry is blocked and the business action runs
/// exactly once.
///
/// This is the load-bearing pair from `invariant.rs`, repeated for a v0 message with a
/// lookup table, because the guarantee has to hold for the transaction shape people actually
/// build.
#[test]
fn rebuilt_v0_retry_is_blocked_and_the_business_action_runs_once() {
    banner("v0: a rebuilt retry is blocked, and the action runs once");
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let claim = ClaimArgs::new(authority, "ns", "v0_retry", sha256(b"payload"));
    let looked_up = vec![
        claim.receipt(),
        pubkey!("Sysvar1nstructions1111111111111111111111111"),
        pubkey!("11111111111111111111111111111111"),
        counter_pda(&authority),
        pubkey!("EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5"),
    ];
    let table = env.create_lookup_table(&looked_up);

    // Attempt 1, as built by a client that has not yet seen a response.
    let first = env.build_v0(
        &[claim.instruction(), increment_ix(authority)],
        table,
        &looked_up,
        env.svm.latest_blockhash(),
    );
    assert_success(&env.svm.send_transaction(first.clone()));
    assert_eq!(env.counter_value(&authority), 1);

    // Attempt 2: the response was lost, so the client rebuilds. A *different* blockhash
    // means different message bytes and therefore a different signature, so the runtime's
    // message-hash deduplication does not apply. Only the guard can stop this.
    env.svm.expire_blockhash();
    let second = env.build_v0(
        &[claim.instruction(), increment_ix(authority)],
        table,
        &looked_up,
        env.svm.latest_blockhash(),
    );

    assert_ne!(
        first.signatures[0], second.signatures[0],
        "the two attempts must be genuinely different signed transactions, or this proves nothing"
    );

    let res = env.svm.send_transaction(second);
    assert_custom_error(&res, E_ALREADY_COMMITTED);
    assert_eq!(
        env.counter_value(&authority),
        1,
        "the rebuilt retry must not have incremented the counter a second time"
    );
}

/// A signer listed in a lookup table is **not loaded from it** — it stays in the static keys.
///
/// This is the boundary the other v0 tests rest on. My first version of this test asserted
/// that `try_compile` would *fail* when handed a table containing the signer. It does not:
/// `CompiledKeys::try_extract_table_lookup` only extracts non-signer keys, so the signer is
/// silently kept static and compilation succeeds. That is the correct behaviour, and it is a
/// better property to pin than the failure I expected — because a loaded address cannot
/// satisfy a signature requirement, a v0 message that *did* try to load one would be
/// unsignable, and the failure would surface far from its cause.
#[test]
fn a_signer_in_a_lookup_table_stays_in_the_static_keys() {
    banner("v0: a signer is never loaded from a lookup table");
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let claim = ClaimArgs::new(authority, "ns", "v0_signer", sha256(b"payload"));

    // A table whose only entry is the signer.
    let table_key = env.create_lookup_table(&[authority]);
    let table = AddressLookupTableAccount {
        key: table_key,
        addresses: vec![authority],
    };

    let message = v0::Message::try_compile(
        &authority,
        &[claim.instruction(), increment_ix(authority)],
        &[table],
        env.svm.latest_blockhash(),
    )
    .expect("a table containing a signer must still compile, with the signer left static");

    assert!(
        message.account_keys.contains(&authority),
        "the signer must remain in the static account keys"
    );

    let loaded: usize = message
        .address_table_lookups
        .iter()
        .map(|lookup| lookup.writable_indexes.len() + lookup.readonly_indexes.len())
        .sum();
    assert_eq!(
        loaded, 0,
        "nothing should have been loaded from a table whose only entry is a signer"
    );

    // And the transaction is genuinely usable, which is the point of keeping it static.
    assert_success(&env.send_v0(
        &[claim.instruction(), increment_ix(authority)],
        table_key,
        &[authority],
    ));
    assert_eq!(env.counter_value(&authority), 1);
}
