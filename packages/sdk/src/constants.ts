/**
 * Constants shared by every part of the SDK.
 *
 * These values mirror `programs/commit-once/src/constants.rs` and
 * `programs/commit-once/src/state.rs`. `test/vectors.test.ts` asserts that the
 * discriminators and domain-separated hashes below match the compiled program's IDL and
 * the Rust test suite, so the two implementations cannot drift apart silently.
 */

import { address, type Address } from '@solana/kit';

/**
 * The CommitOnce program address. Matches `declare_id!` in
 * `programs/commit-once/src/lib.rs`, which is itself derived from
 * `deploy-keys/commit_once-keypair.json`.
 */
export const COMMIT_ONCE_PROGRAM_ADDRESS: Address = address(
    'CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB',
);

/** The System Program. */
export const SYSTEM_PROGRAM_ADDRESS: Address = address('11111111111111111111111111111111');

/** The Instructions sysvar, read onchain to detect durable-nonce transactions. */
export const INSTRUCTIONS_SYSVAR_ADDRESS: Address = address(
    'Sysvar1nstructions1111111111111111111111111',
);

/**
 * PDA seed prefix for an intent receipt.
 *
 * The full seed tuple is `[RECEIPT_SEED, authority, namespace_hash, idempotency_key_hash]`
 * and every element is a fixed size (11 / 32 / 32 / 32 bytes). Arbitrary-length namespace
 * and key strings are therefore never placed directly into PDA seeds.
 */
export const RECEIPT_SEED: Uint8Array = new TextEncoder().encode('commit-once');

/** Account layout version written by this program version. */
export const RECEIPT_VERSION = 1;

/** Retention sentinel meaning "this receipt never expires and can never be closed". */
export const PERMANENT_RETENTION = 0n;

/** Shortest accepted non-zero retention: one hour. */
export const MIN_RETENTION_SECONDS = 3_600n;

/** Longest accepted finite retention: 365 days. */
export const MAX_RETENTION_SECONDS = 31_536_000n;

/**
 * Slot-time assumption used onchain to derive the monotonic slot deadline. Mainnet has
 * run 250ms slots since epoch 1036, i.e. 4 slots per second.
 */
export const SLOTS_PER_SECOND = 4n;

/** Serialized size of an `IntentReceipt` account, including the 8-byte discriminator. */
export const RECEIPT_ACCOUNT_SIZE = 202;

/** Per-account overhead the runtime adds when computing rent exemption. */
export const ACCOUNT_STORAGE_OVERHEAD = 128n;

/**
 * Mainnet rent rate in lamports per byte, since SIMD-0437 step 2 (epoch 1033).
 *
 * Note that the `solana-rent` Rust crate still ships an effective 6960 lamports/byte, so
 * any rent figure derived from that crate is 37% too high.
 */
export const MAINNET_LAMPORTS_PER_BYTE = 5_080n;

/**
 * Rent-exempt deposit a `claim` creates for its receipt, in lamports.
 *
 * At mainnet rates this is `(202 + 128) * 5080 = 1_676_400` lamports
 * (~0.00168 SOL). It is refunded in full by `close_receipt` after expiry.
 */
export const RECEIPT_RENT_LAMPORTS =
    (BigInt(RECEIPT_ACCOUNT_SIZE) + ACCOUNT_STORAGE_OVERHEAD) * MAINNET_LAMPORTS_PER_BYTE;

/** Domain separator for namespace hashing. Part of the cross-language contract. */
export const NAMESPACE_DOMAIN = 'commitonce/namespace/v1';

/** Domain separator for idempotency-key hashing. Part of the cross-language contract. */
export const IDEMPOTENCY_KEY_DOMAIN = 'commitonce/key/v1';

/**
 * Anchor instruction discriminators: `sha256("<namespace>:<name>")[0..8]`.
 *
 * Hardcoded rather than computed because computing them would force every instruction
 * builder to be asynchronous. `test/vectors.test.ts` recomputes them and compares against
 * the generated IDL, so a mismatch is a test failure rather than a silent runtime error.
 */
export const CLAIM_DISCRIMINATOR: Uint8Array = new Uint8Array([
    62, 198, 214, 193, 213, 159, 108, 210,
]);

/** `sha256("global:close_receipt")[0..8]`. */
export const CLOSE_RECEIPT_DISCRIMINATOR: Uint8Array = new Uint8Array([
    126, 254, 244, 203, 124, 164, 134, 89,
]);

/** `sha256("account:IntentReceipt")[0..8]`. */
export const INTENT_RECEIPT_DISCRIMINATOR: Uint8Array = new Uint8Array([
    84, 252, 93, 100, 126, 80, 15, 134,
]);

/**
 * Anchor event discriminators: `sha256("event:<Name>")[0..8]`.
 *
 * Anchor emits an event as a program log line of the form
 * `Program data: <base64>`, where the decoded bytes are the 8-byte discriminator followed
 * by the Borsh-encoded event body. There is no other channel: an event is not an account and
 * not a return value, so this is the only way to read one from a transaction.
 *
 * `test/events.test.ts` decodes an `IntentCommitted` emitted by the real deployed program on
 * devnet, so these values are checked against the chain and not merely against the IDL.
 */
export const INTENT_COMMITTED_EVENT_DISCRIMINATOR: Uint8Array = new Uint8Array([
    4, 249, 73, 51, 216, 110, 196, 249,
]);

/** `sha256("event:IntentReceiptClosed")[0..8]`. */
export const INTENT_RECEIPT_CLOSED_EVENT_DISCRIMINATOR: Uint8Array = new Uint8Array([
    187, 91, 174, 175, 38, 219, 181, 108,
]);

/**
 * Borsh-encoded size of each event body, excluding the 8-byte discriminator.
 *
 * `IntentCommitted` is `5 × 32 + 4 × 8 = 192`; `IntentReceiptClosed` is `4 × 32 + 8 = 136`.
 */
export const INTENT_COMMITTED_EVENT_SIZE = 192;
export const INTENT_RECEIPT_CLOSED_EVENT_SIZE = 136;

/** The log prefix Anchor uses for an emitted event. */
export const PROGRAM_DATA_LOG_PREFIX = 'Program data: ';
