use anchor_lang::prelude::*;

/// PDA seed prefix for an intent receipt.
///
/// The full seed tuple is `[RECEIPT_SEED, authority, namespace_hash, idempotency_key_hash]`.
/// Every seed is fixed size (11 / 32 / 32 / 32 bytes), so arbitrary-length namespace and
/// idempotency-key strings are never placed directly into PDA seeds.
#[constant]
pub const RECEIPT_SEED: &[u8] = b"commit-once";

/// Account layout version written by this program version.
#[constant]
pub const RECEIPT_VERSION: u8 = 1;

/// Sentinel retention value meaning "this receipt never expires".
#[constant]
pub const PERMANENT_RETENTION: u64 = 0;

/// Shortest accepted non-zero retention: 1 hour.
///
/// A signed transaction built on a recent blockhash is only valid for roughly
/// `MAX_PROCESSING_AGE` slots. Mainnet has run 250ms slots since epoch 1036, so that
/// window is now roughly **38 seconds**. One hour is nearly two orders of magnitude
/// longer, so a receipt can never be cleaned up while a blockhash-based duplicate of the
/// same transaction is still executable.
#[constant]
pub const MIN_RETENTION_SECONDS: u64 = 60 * 60;

/// Longest accepted finite retention: 365 days. Use [`PERMANENT_RETENTION`] for longer.
#[constant]
pub const MAX_RETENTION_SECONDS: u64 = 365 * 24 * 60 * 60;

/// Slot-time assumption used to derive the monotonic slot deadline from a
/// second-based retention.
///
/// Mainnet activated 250ms slots in epoch 1036, i.e. 4 slots/second. This constant is
/// deliberately set to the *current* mainnet rate rather than the 400ms historical
/// target, because underestimating it would make `expires_at_slot` land earlier than the
/// advertised wall-clock retention.
///
/// The slot deadline is only ever used as an *additional* gate alongside the wall-clock
/// deadline, never as a replacement for it. See `close_receipt`: a receipt closes only
/// when **both** deadlines have passed, so a future change to slot timing can only ever
/// delay cleanup (which is safe) and never accelerate it (which would reopen a duplicate
/// window).
#[constant]
pub const SLOTS_PER_SECOND: u64 = 4;

/// System program discriminator for `AdvanceNonceAccount`
/// (`SystemInstruction::AdvanceNonceAccount`).
#[constant]
pub const ADVANCE_NONCE_ACCOUNT_DISCRIMINATOR: u32 = 4;

/// Upper bound on instructions scanned when looking for durable-nonce semantics.
///
/// **This is a refusal threshold, not just a work bound.** A transaction carrying more
/// instructions than this is rejected with `InstructionScanInconclusive` when a finite
/// retention is requested, because the program cannot prove the transaction is nonce-free.
/// The alternative — assuming "no nonce found within the bound" means "no nonce" — is a
/// bypass: an instruction with no accounts and no data compiles to three bytes, so a
/// transaction can carry hundreds of them well inside the 1232-byte packet limit and push
/// a real `AdvanceNonceAccount` past the bound.
///
/// 128 is far above any realistic transaction (the guard itself is one instruction, and a
/// typical transaction is under thirty), and `PERMANENT_RETENTION` skips the scan entirely.
///
/// Deliberately *not* marked `#[constant]`: anchor's `#[constant]` attribute cannot
/// expand `usize`, and this bound is an implementation detail that has no business in
/// the public IDL.
pub const MAX_INSTRUCTION_SCAN: usize = 128;
