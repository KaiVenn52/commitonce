use anchor_lang::prelude::*;

#[error_code]
pub enum CommitOnceError {
    /// The intent already committed with an identical payload fingerprint.
    #[msg("This intent has already been committed")]
    AlreadyCommitted,
    /// The idempotency key was reused with a different payload fingerprint.
    #[msg("This idempotency key was already used for a different payload")]
    IdempotencyConflict,
    /// Durable-nonce transactions cannot be combined with expiring receipts.
    #[msg("Durable nonce transactions are not supported with expiring retention")]
    DurableNonceUnsupported,
    /// Retention was neither permanent nor within the accepted range.
    #[msg("Retention must be 0 (permanent) or between 1 hour and 365 days")]
    InvalidRetention,
    /// The refund destination was the default pubkey or the receipt itself.
    #[msg("Invalid refund destination")]
    InvalidRefundDestination,
    /// The account at the receipt PDA is not owned by this program.
    #[msg("Receipt account is not owned by the CommitOnce program")]
    InvalidReceiptOwner,
    /// The stored receipt disagrees with the instruction: it records a different namespace
    /// or idempotency key hash than the one being claimed.
    ///
    /// Note that a receipt which fails to *deserialize* does not produce this error — that
    /// surfaces as Anchor's own `AccountDidNotDeserialize` from `IntentReceipt::try_deserialize`
    /// in the handler. This code covers the case where the bytes decoded cleanly but do not
    /// describe the intent the caller is asking about, which would otherwise mean the PDA
    /// seed binding had been bypassed.
    #[msg("Receipt account is malformed")]
    InvalidReceiptData,
    /// The receipt belongs to a different authority.
    #[msg("Receipt belongs to a different authority")]
    InvalidReceiptAuthority,
    /// The receipt was written by a newer, unsupported layout version.
    #[msg("Unsupported receipt layout version")]
    UnsupportedReceiptVersion,
    /// Cleanup was attempted before the retention period elapsed.
    #[msg("Receipt has not expired yet")]
    ReceiptNotExpired,
    /// Permanent receipts have no expiry and can never be closed.
    #[msg("Permanent receipts cannot be closed")]
    ReceiptIsPermanent,
}
