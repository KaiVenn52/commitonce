use anchor_lang::prelude::*;

use crate::{error::CommitOnceError, events::IntentReceiptClosed, state::IntentReceipt};

#[derive(Accounts)]
pub struct CloseReceipt<'info> {
    /// The receipt to close. Ownership and discriminator are enforced by
    /// `Account<'info, IntentReceipt>`.
    #[account(mut, close = refund_destination)]
    pub receipt: Account<'info, IntentReceipt>,

    /// Receives the rent deposit. Constrained to the immutable destination recorded on
    /// the receipt, which is what makes cleanup permissionless without being theft.
    ///
    /// CHECK: address-constrained against `receipt.refund_destination`.
    #[account(mut, address = receipt.refund_destination)]
    pub refund_destination: UncheckedAccount<'info>,
}

/// Close an expired receipt and return its rent deposit to the immutable
/// `refund_destination` recorded at claim time.
///
/// Permissionless: anyone may call this, because the destination cannot be redirected.
/// Closing a receipt ends CommitOnce's protection for newly reconstructed transactions
/// that reuse the same idempotency key.
pub fn handle_close_receipt(ctx: Context<CloseReceipt>) -> Result<()> {
    let receipt = &ctx.accounts.receipt;

    require!(!receipt.is_permanent(), CommitOnceError::ReceiptIsPermanent);

    let clock = Clock::get()?;
    // Both gates must pass. The slot deadline is monotonic and cannot be manipulated by
    // a validator; the wall-clock deadline keeps the advertised retention honest even if
    // slots run faster than SLOTS_PER_SECOND.
    require!(
        clock.slot >= receipt.expires_at_slot,
        CommitOnceError::ReceiptNotExpired
    );
    require!(
        clock.unix_timestamp >= receipt.expires_at_unix_ts,
        CommitOnceError::ReceiptNotExpired
    );

    emit!(IntentReceiptClosed {
        authority: receipt.authority,
        namespace_hash: receipt.namespace_hash,
        idempotency_key_hash: receipt.idempotency_key_hash,
        payload_hash: receipt.payload_hash,
        closed_slot: clock.slot,
    });

    Ok(())
}
