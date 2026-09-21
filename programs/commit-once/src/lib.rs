//! # CommitOnce — onchain idempotency keys for Solana
//!
//! Solana deduplicates an *identical signed transaction* because identical message bytes
//! produce an identical signature. A **logical user intent** is not the same thing as a
//! transaction signature. When an application receives an ambiguous timeout, rebuilds
//! the transaction with a fresh blockhash, changes the priority fee, changes the route,
//! or otherwise re-signs, the replacement has different bytes and therefore a different
//! signature. Network-level deduplication can no longer guarantee that the intent
//! executes only once.
//!
//! This program makes that guarantee composable onchain. A `claim` instruction is
//! prepended to the *same atomic transaction* as the business instructions:
//!
//! ```text
//! [ commit_once::claim(intent) ]   <- creates a receipt PDA, or aborts
//! [ jupiter swap / spl transfer / mint / game action / ... ]
//! ```
//!
//! Invariant, for one `(authority, namespace_hash, idempotency_key_hash)` tuple:
//!
//! > no more than one guarded transaction may successfully commit during the receipt
//! > retention period.
//!
//! Two consequences follow from Solana's atomicity:
//!
//! * If any later instruction in the transaction fails, the whole transaction is rolled
//!   back and the receipt does not exist. There is no window in which a receipt exists
//!   without its business action having committed.
//! * If a receipt already exists, `claim` returns an error. The error fails the
//!   transaction, so the business instructions after it never run.
//!
//! This is **at-most-once** successful execution of a guarded logical intent within the
//! configured retention window. Combined with client retry-until-success it yields
//! exactly-once-style application semantics. It is not a claim of mathematically
//! universal exactly-once execution.

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

// Program ID is derived from the committed keypair at deploy-keys/commit_once-keypair.json.
// It is deliberately identical on every cluster, because `declare_id!` is compiled into
// the program: a program deployed at a different address than its `declare_id!` refuses
// to run. `scripts/build.sh` verifies this pairing after every build.
declare_id!("CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB");

#[program]
pub mod commit_once {
    use super::*;

    /// Claim a logical intent. See [`instructions::claim`] for the full contract.
    pub fn claim(
        ctx: Context<Claim>,
        namespace_hash: [u8; 32],
        idempotency_key_hash: [u8; 32],
        payload_hash: [u8; 32],
        retention_seconds: u64,
        refund_destination: Pubkey,
    ) -> Result<()> {
        crate::instructions::claim::handle_claim(
            ctx,
            namespace_hash,
            idempotency_key_hash,
            payload_hash,
            retention_seconds,
            refund_destination,
        )
    }

    /// Close an expired receipt and refund its rent deposit.
    pub fn close_receipt(ctx: Context<CloseReceipt>) -> Result<()> {
        crate::instructions::close_receipt::handle_close_receipt(ctx)
    }
}
