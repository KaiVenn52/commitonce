//! Wire-format checks.
//!
//! These tests exist because the test harness hand-encodes the `demo-counter` interface
//! instead of linking its crate (two Anchor programs in one test binary collide on the
//! `entrypoint` symbol). Hand-encoding is only safe if the bytes are verified against the
//! real definitions, so this file recomputes every discriminator and layout constant from
//! first principles and fails if anything drifts.
//!
//! It also pins the **cross-language contract** with the TypeScript SDK: the
//! domain-separated hashes below are asserted to fixed hex values that
//! `packages/sdk/test/vectors.test.ts` asserts independently. If either side changes its
//! derivation, one of the two suites fails.

mod common;

use common::*;
// `.data()` on an Anchor instruction struct comes from `InstructionData`, and the struct's
// fields need `Pubkey` in scope.
use anchor_lang::{prelude::Pubkey, InstructionData};

/// Anchor derives a discriminator as `sha256("<namespace>:<name>")[0..8]`.
fn anchor_discriminator(namespace: &str, name: &str) -> [u8; 8] {
    sha256(format!("{namespace}:{name}").as_bytes())
        .get(0..8)
        .expect("sha256 is 32 bytes")
        .try_into()
        .expect("8 bytes")
}

#[test]
fn demo_counter_discriminators_match_the_program() {
    assert_eq!(
        anchor_discriminator("global", "initialize"),
        INITIALIZE_DISCRIMINATOR
    );
    assert_eq!(
        anchor_discriminator("global", "increment"),
        INCREMENT_DISCRIMINATOR
    );
    assert_eq!(
        anchor_discriminator("account", "Counter"),
        COUNTER_ACCOUNT_DISCRIMINATOR
    );
}

#[test]
fn commit_once_discriminators_are_well_formed() {
    // Two things are checked here, and it is worth being precise about which one does the work.
    //
    // **What actually pins the instruction names is elsewhere, and it is a compile error.** This
    // harness builds instructions through `commit_once::instruction::Claim`, so renaming the
    // handler in the program makes that path fail to resolve and the test binary does not build
    // at all. Verified by doing it: renaming `claim` yields `struct Claim is private` and the
    // tests never run. So the pin is real, but it is implicit — a reader of this file would not
    // see it.
    //
    // **The assertions below make this file self-contained.** They compare the compiled
    // program's own instruction data against the derivation of the expected name, so the pin
    // survives a refactor of `common/mod.rs` that stopped referencing the struct. That is a
    // second line rather than the only one, and it is stated that way on purpose.
    let claim = anchor_discriminator("global", "claim");
    let close = anchor_discriminator("global", "close_receipt");
    let receipt = anchor_discriminator("account", "IntentReceipt");

    assert_eq!(claim.len(), 8);
    assert_ne!(claim, close, "instruction names must not collide");
    assert_ne!(
        claim, receipt,
        "instruction and account namespaces must not collide"
    );

    // The program's real instruction data, whose first eight bytes are the discriminator.
    let claim_data = commit_once::instruction::Claim {
        namespace_hash: [0u8; 32],
        idempotency_key_hash: [0u8; 32],
        payload_hash: [0u8; 32],
        retention_seconds: 0,
        refund_destination: Pubkey::default(),
    }
    .data();
    assert_eq!(
        claim_data[..8],
        claim,
        "the compiled `claim` instruction is no longer named `claim`"
    );

    let close_data = commit_once::instruction::CloseReceipt {}.data();
    assert_eq!(
        close_data[..8],
        close,
        "the compiled `close_receipt` instruction is no longer named `close_receipt`"
    );
}

#[test]
fn receipt_account_layout_is_exactly_202_bytes() {
    // 8 discriminator
    // + 1 version + 1 bump
    // + 32 authority + 32 namespace + 32 key + 32 payload + 32 refund_destination
    // + 8 created_slot + 8 expires_at_slot + 8 created_unix_ts + 8 expires_at_unix_ts
    let expected = 8 + 1 + 1 + 32 * 5 + 8 * 4;
    assert_eq!(expected, 202);
    assert_eq!(commit_once::state::IntentReceipt::LEN, expected);
}

#[test]
fn counter_account_layout_is_exactly_88_bytes() {
    let expected = 8 + 32 + 8 + 8 + 32;
    assert_eq!(expected, COUNTER_ACCOUNT_LEN);
    assert_eq!(COUNTER_COUNT_OFFSET, 40);
}

/// The cross-language hashing contract, pinned to fixed values.
///
/// `packages/sdk/test/vectors.test.ts` asserts the identical hex strings. Neither side
/// can change its domain separator, its prefix order, or its encoding without failing
/// one of these two suites — which is what makes it safe for the onchain program to treat
/// these hashes as opaque.
#[test]
fn domain_separated_hash_vectors_are_stable() {
    assert_eq!(
        hex(&namespace_hash("demo:counter")),
        "7b2ba4a847222b78b1655df2392e89a615434dd1cff70554e59a8b80d3258ddf"
    );
    assert_eq!(
        hex(&namespace_hash("payments:transfer")),
        "9e7bb3a4dce399c675e567cec2312197966a9dd8ab00b93834b82ead8a49cde3"
    );
    assert_eq!(
        hex(&idempotency_key_hash("order_928")),
        "0a9ba9a57e3b998c5807159e02e362f2d14c85cfe02e5b508e7f2cfd2d3d4e0d"
    );
    assert_eq!(
        hex(&idempotency_key_hash("order_1")),
        "388806aee4466141bbdfd00b3d65f34cf840ec6b5edd4bdd9687ce73b1aee278"
    );
}

/// The two domains must be separated: hashing the same string as a namespace and as a key
/// must never produce the same digest, or one application's key space could shadow
/// another's namespace.
#[test]
fn namespace_and_key_domains_are_separated() {
    for value in ["demo:counter", "order_928", ""] {
        assert_ne!(
            namespace_hash(value),
            idempotency_key_hash(value),
            "domain separation failed for {value:?}"
        );
    }
}

/// Hashing must be injective enough that distinct inputs never collide, including inputs
/// that are prefixes of one another — the reason the domain is concatenated rather than
/// used as a delimiter.
#[test]
fn hashing_distinguishes_prefix_and_concatenation_attacks() {
    // "a" + "bc" and "ab" + "c" are different namespaces.
    assert_ne!(namespace_hash("abc"), namespace_hash("ab:c"));

    // A namespace that happens to look like the domain prefix must not alias the domain.
    assert_ne!(
        namespace_hash("commitonce/namespace/v1"),
        namespace_hash("")
    );
}

/// The payload fingerprint is a plain SHA-256 over the canonical encoding. These vectors
/// pin the *raw byte* hashes used across the Rust suite so a change to the canonical
/// encoding in the SDK is caught here too.
#[test]
fn payload_hash_vectors_are_stable() {
    assert_eq!(
        hex(&sha256(b"increment")),
        "f679230253e596b02442b1ca20083da5efd7bf5dfe48a9814afb6fe8ebe58bc9"
    );
    assert_eq!(
        hex(&sha256(b"payload")),
        "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5"
    );
}

#[test]
fn rent_deposit_matches_the_mainnet_rate() {
    // (202 data bytes + 128 account overhead) * 5080 lamports/byte, since SIMD-0437 step 2.
    assert_eq!(
        mainnet_rent_exempt_minimum(commit_once::state::IntentReceipt::LEN as u64),
        1_676_400
    );
    // The stale `solana-rent` crate constant would have given a 37% higher figure.
    assert_eq!(
        mainnet_rent_exempt_minimum(commit_once::state::IntentReceipt::LEN as u64),
        RECEIPT_RENT_LAMPORTS
    );
}

/// Receipt PDA addresses, pinned to fixed values shared with the SDK.
///
/// This is the cross-language contract that matters most, and it is worth being explicit
/// about why. A receipt PDA is *the* identity of an intent. If the TypeScript SDK derives a
/// different address than this program does, then the guard silently stops guarding: the
/// client would create one receipt while checking another, every retry would succeed, and
/// nothing would error. There is no runtime check that catches that class of bug — the
/// derivation is spread across two languages and only the vectors tie them together.
///
/// The authority here is `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`, chosen because it
/// is a stable, well-known address rather than a throwaway keypair, so the vectors stay
/// meaningful across machines and across time.
///
/// `packages/sdk/test/vectors.test.ts` asserts the identical addresses for the identical
/// inputs, and `packages/sdk/scripts/print-vectors.mjs` recomputes them from `@solana/kit`
/// primitives *without importing the SDK* — so a change to either implementation's seed
/// order, domain separator, or hash function fails a test rather than shipping.
#[test]
fn receipt_pda_vectors_are_stable_across_languages() {
    use solana_pubkey::pubkey;

    let authority = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

    // (namespace, key, expected address, expected bump) — values produced by the SDK.
    let vectors = [
        (
            "demo:counter",
            "order_928",
            "7vMcWBtiMjeFgpx96E5ZtVZoYeRLn5Fu57RcTtzJeh9J",
            254u8,
        ),
        (
            "payments:transfer",
            "order_928",
            "654vyv9LHwgAgn2rceouNQj8GXwiatAseFZAKCPPSTYV",
            255u8,
        ),
        (
            "app_a:swap",
            "order_928",
            "4MiJeybibL5QoA6m8Q8ddUuzWnoumZxLPj32G3DHTbFG",
            255u8,
        ),
    ];

    for (namespace, key, expected_address, expected_bump) in vectors {
        let ns = namespace_hash(namespace);
        let k = idempotency_key_hash(key);

        let derived = derive_receipt(&authority, &ns, &k);
        assert_eq!(
            derived.to_string(),
            expected_address,
            "receipt PDA mismatch for namespace {namespace:?} key {key:?} — the SDK and the \
             program disagree on the derivation, which would silently disable the guard"
        );

        // Re-derive through the runtime's own PDA function to prove the address really is
        // the canonical one for these seeds, and to pin the bump the program will use.
        let seeds: &[&[u8]] = &[
            commit_once::RECEIPT_SEED,
            authority.as_ref(),
            ns.as_ref(),
            k.as_ref(),
        ];
        let (canonical, bump) =
            solana_pubkey::Pubkey::find_program_address(seeds, &commit_once::ID);
        assert_eq!(
            canonical, derived,
            "derive_receipt disagrees with find_program_address for {namespace:?}/{key:?}"
        );
        assert_eq!(
            bump, expected_bump,
            "bump mismatch for namespace {namespace:?} key {key:?}"
        );
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
