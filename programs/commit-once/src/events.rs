use anchor_lang::prelude::*;

/// Emitted whenever a receipt is created, i.e. whenever a guarded intent commits for
/// the first time. Indexers use this to count successful guarded intents and active
/// namespaces without replaying every transaction.
#[event]
pub struct IntentCommitted {
    pub authority: Pubkey,
    pub namespace_hash: [u8; 32],
    pub idempotency_key_hash: [u8; 32],
    pub payload_hash: [u8; 32],
    pub refund_destination: Pubkey,
    pub created_slot: u64,
    pub expires_at_slot: u64,
    pub created_unix_ts: i64,
    pub expires_at_unix_ts: i64,
}

/// Emitted when an expired receipt is closed and its rent deposit is returned.
#[event]
pub struct IntentReceiptClosed {
    pub authority: Pubkey,
    pub namespace_hash: [u8; 32],
    pub idempotency_key_hash: [u8; 32],
    pub payload_hash: [u8; 32],
    pub closed_slot: u64,
}
