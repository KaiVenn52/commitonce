use anchor_lang::prelude::*;

/// Onchain receipt for one `(authority, namespace, idempotency key)` tuple.
///
/// The layout is fixed size and explicitly versioned so that indexers and the SDK can
/// decode it without an IDL round trip. Every field after `bump` is either an input to
/// the PDA derivation, a value the client supplied at claim time, or a clock reading.
#[account]
#[derive(InitSpace)]
pub struct IntentReceipt {
    /// Layout version. `0` is never written; it is reserved as "not a receipt".
    pub version: u8,
    /// Canonical PDA bump.
    pub bump: u8,
    /// Authority that claimed the intent. Also bound through the PDA seeds.
    pub authority: Pubkey,
    /// `sha256("commitonce/namespace/v1" || namespace_utf8)`.
    pub namespace_hash: [u8; 32],
    /// `sha256("commitonce/key/v1" || idempotency_key_utf8)`.
    pub idempotency_key_hash: [u8; 32],
    /// Fingerprint of the semantic payload. Defines what "the same intent" means.
    pub payload_hash: [u8; 32],
    /// Immutable rent refund destination.
    pub refund_destination: Pubkey,
    /// Slot at which the receipt was created.
    pub created_slot: u64,
    /// Slot at or after which cleanup is permitted. `0` means permanent.
    pub expires_at_slot: u64,
    /// Wall-clock creation time, for indexing.
    pub created_unix_ts: i64,
    /// Wall-clock deadline. `0` means permanent.
    pub expires_at_unix_ts: i64,
}

impl IntentReceipt {
    /// Total account size in bytes, including the 8-byte Anchor discriminator.
    pub const LEN: usize = 8 + Self::INIT_SPACE;

    /// `true` when this receipt has no expiry and can never be closed.
    pub fn is_permanent(&self) -> bool {
        self.expires_at_slot == 0
    }
}
