//! # demo-counter
//!
//! A deliberately tiny program used as the *business action* in the CommitOnce A/B
//! demo. It gives the demo a deterministic, observable side effect: an onchain
//! counter that either incremented once or twice.
//!
//! This program knows nothing about CommitOnce. That is the point: the guard is a
//! separate instruction in the same atomic transaction, and the downstream program
//! does not integrate, import, or even know about it.

use anchor_lang::prelude::*;

// Derived from deploy-keys/demo_counter-keypair.json; identical on every cluster.
declare_id!("EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5");

/// PDA seed prefix for the counter.
const COUNTER_SEED: &[u8] = b"counter";

/// PDA seed prefix for the vault.
///
/// A separate account from the counter on purpose: it stands in for a Squads vault, which is an
/// account that holds value and can only be signed for by its owning program.
const VAULT_SEED: &[u8] = b"vault";

#[program]
pub mod demo_counter {
    use super::*;

    /// Create the counter for `owner`. Idempotent by construction: fails if it exists.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.owner = ctx.accounts.owner.key();
        counter.count = 0;
        counter.last_slot = Clock::get()?.slot;
        counter.last_actor = ctx.accounts.owner.key();
        Ok(())
    }

    /// The business action. Increment the counter exactly once per successful call.
    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let clock = Clock::get()?;
        let counter = &mut ctx.accounts.counter;
        counter.count = counter
            .count
            .checked_add(1)
            .ok_or(DemoCounterError::Overflow)?;
        counter.last_slot = clock.slot;
        counter.last_actor = ctx.accounts.owner.key();

        emit!(Incremented {
            counter: counter.key(),
            count: counter.count,
            slot: clock.slot,
            actor: ctx.accounts.owner.key(),
        });

        Ok(())
    }

    /// Increment, but call `commit_once::claim` first **from inside this program**.
    ///
    /// This is the second way to use CommitOnce, and the one the client-side pattern cannot
    /// cover: instead of asking every caller to prepend the guard, the program guards itself.
    /// Any client that invokes this instruction gets the at-most-once guarantee without
    /// knowing the guard exists.
    ///
    /// It is also the only way a **PDA** can be an authority. `claim` requires its authority to
    /// be a `Signer`, and a PDA cannot sign for itself directly — but a program can sign for
    /// its own PDA through `invoke_signed`, which is what a Squads vault or any other
    /// program-owned account would need. Here the authority is the ordinary transaction
    /// signer, because that is the simpler case and it still exercises the CPI path: the
    /// question being answered is whether another program can call `claim` at all.
    ///
    /// **The guard is still atomic with the action**, which is the property that matters. The
    /// CPI and the increment below are in the same instruction, so if `claim` returns
    /// `AlreadyCommitted` the increment never runs and the whole transaction reverts.
    pub fn increment_guarded(
        ctx: Context<IncrementGuarded>,
        namespace_hash: [u8; 32],
        idempotency_key_hash: [u8; 32],
        payload_hash: [u8; 32],
        retention_seconds: u64,
    ) -> Result<()> {
        // The rent deposit is refunded to the authority on cleanup, so the authority is the
        // natural destination and the one `claim` would have used had the client called it.
        let refund_destination = ctx.accounts.owner.key();

        commit_once::cpi::claim(
            CpiContext::new(
                commit_once::id(),
                commit_once::cpi::accounts::Claim {
                    authority: ctx.accounts.owner.to_account_info(),
                    receipt: ctx.accounts.receipt.to_account_info(),
                    instructions_sysvar: ctx.accounts.instructions_sysvar.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ),
            namespace_hash,
            idempotency_key_hash,
            payload_hash,
            retention_seconds,
            refund_destination,
        )?;

        let clock = Clock::get()?;
        let counter = &mut ctx.accounts.counter;
        counter.count = counter
            .count
            .checked_add(1)
            .ok_or(DemoCounterError::Overflow)?;
        counter.last_slot = clock.slot;
        counter.last_actor = ctx.accounts.owner.key();

        emit!(Incremented {
            counter: counter.key(),
            count: counter.count,
            slot: clock.slot,
            actor: ctx.accounts.owner.key(),
        });

        Ok(())
    }

    /// Increment, guarding the action with **a PDA as the authority**.
    ///
    /// This is the case a Squads vault, or any other program-owned account, actually needs.
    /// `claim` requires its authority to be a `Signer`. An ordinary PDA cannot produce a
    /// signature, so the only way it can be an authority is for a program to sign on its behalf
    /// with `invoke_signed` — which is exactly what this instruction does, using the vault PDA's
    /// own seeds.
    ///
    /// The distinction from `increment_guarded` is not cosmetic. There, the authority is the
    /// transaction's signer and its signer privilege simply propagates through the CPI. Here the
    /// authority is an account with no keypair at all, and the privilege exists only because this
    /// program asserts it. If `claim`'s `Signer` constraint could be satisfied any other way, or
    /// if the seeds here did not match the receipt's derivation, this is where it would show.
    ///
    /// Note what the PDA is: `[b"vault", owner]`, deliberately **not** the counter. A vault that
    /// is also the account being mutated would conflate two roles, and a real integration keeps
    /// them apart. The receipt is derived from the vault, so every member of a multisig sharing
    /// one vault shares one receipt — which is the property `docs/ARCHITECTURE.md` §11 describes
    /// and previously could only assert.
    pub fn increment_guarded_by_vault(
        ctx: Context<IncrementGuardedByVault>,
        namespace_hash: [u8; 32],
        idempotency_key_hash: [u8; 32],
        payload_hash: [u8; 32],
        retention_seconds: u64,
    ) -> Result<()> {
        let owner = ctx.accounts.owner.key();

        // The seeds the vault PDA was derived from. `invoke_signed` turns these into a signature
        // that exists only for the duration of the CPI.
        let vault_seeds: &[&[u8]] = &[VAULT_SEED, owner.as_ref(), &[ctx.bumps.vault]];

        // The deposit is refunded to the vault, which paid it. A real vault would then have its
        // own withdrawal path; this one has none, which is why the test does not close the
        // receipt.
        let refund_destination = ctx.accounts.vault.key();

        commit_once::cpi::claim(
            CpiContext::new_with_signer(
                commit_once::id(),
                commit_once::cpi::accounts::Claim {
                    authority: ctx.accounts.vault.to_account_info(),
                    receipt: ctx.accounts.receipt.to_account_info(),
                    instructions_sysvar: ctx.accounts.instructions_sysvar.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
                &[vault_seeds],
            ),
            namespace_hash,
            idempotency_key_hash,
            payload_hash,
            retention_seconds,
            refund_destination,
        )?;

        let clock = Clock::get()?;
        let counter = &mut ctx.accounts.counter;
        counter.count = counter
            .count
            .checked_add(1)
            .ok_or(DemoCounterError::Overflow)?;
        counter.last_slot = clock.slot;
        counter.last_actor = owner;

        emit!(Incremented {
            counter: counter.key(),
            count: counter.count,
            slot: clock.slot,
            actor: owner,
        });

        Ok(())
    }
}

#[account]
pub struct Counter {
    pub owner: Pubkey,
    pub count: u64,
    pub last_slot: u64,
    pub last_actor: Pubkey,
}

impl Counter {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 32;
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = owner,
        space = Counter::LEN,
        seeds = [b"counter", owner.key().as_ref()],
        bump,
    )]
    pub counter: Account<'info, Counter>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(
        mut,
        seeds = [b"counter", owner.key().as_ref()],
        bump,
    )]
    pub counter: Account<'info, Counter>,

    #[account(mut)]
    pub owner: Signer<'info>,
}

/// Accounts for the CPI variant. `commit_once_program` is declared explicitly rather than
/// inferred, so the caller cannot substitute a different program at the same instruction.
#[derive(Accounts)]
pub struct IncrementGuarded<'info> {
    #[account(
        mut,
        seeds = [b"counter", owner.key().as_ref()],
        bump,
    )]
    pub counter: Account<'info, Counter>,

    /// The intent authority and the rent payer. Must sign, because `claim` requires a signer.
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The CommitOnce receipt PDA. Derived by the caller from
    /// `(authority, namespace_hash, idempotency_key_hash)`; `claim` re-derives and checks it.
    ///
    /// CHECK: not read here. `commit_once::claim` constrains it by `seeds` and verifies its
    /// owner and contents, so a wrong address fails inside the CPI rather than being trusted.
    #[account(mut)]
    pub receipt: UncheckedAccount<'info>,

    /// CHECK: address-constrained to the Instructions sysvar, which `claim` re-validates.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    /// CHECK: address-constrained to the CommitOnce program, so a caller cannot point this at
    /// some other program and have the "guard" be something else. Anchor 1.2.0's
    /// `CpiContext::new` takes a `Pubkey` rather than an `AccountInfo`, so this account exists
    /// to pin the address and `commit_once::id()` supplies the id itself.
    #[account(address = commit_once::id())]
    pub commit_once_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Accounts for the PDA-authority variant.
///
/// `vault` is declared before `receipt` for the same reason `authority` is in `claim`: the
/// receipt's seeds reference it.
#[derive(Accounts)]
pub struct IncrementGuardedByVault<'info> {
    #[account(
        mut,
        seeds = [COUNTER_SEED, owner.key().as_ref()],
        bump,
    )]
    pub counter: Account<'info, Counter>,

    /// The transaction signer. It is *not* the authority — it only identifies which vault to use
    /// and pays the transaction fee.
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The vault PDA. This is the intent authority, and it signs through `invoke_signed`.
    ///
    /// CHECK: the address is constrained by the `seeds`/`bump` constraint below, and `claim`
    /// re-derives the receipt from it. Nothing is read from this account here.
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump,
    )]
    pub vault: UncheckedAccount<'info>,

    /// The CommitOnce receipt PDA, derived from the **vault**, not from `owner`.
    ///
    /// CHECK: not read here. `claim` constrains it by `seeds` and verifies its owner and
    /// contents, so a wrong address fails inside the CPI rather than being trusted.
    #[account(mut)]
    pub receipt: UncheckedAccount<'info>,

    /// CHECK: address-constrained to the Instructions sysvar, which `claim` re-validates.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    /// CHECK: address-constrained to the CommitOnce program.
    #[account(address = commit_once::id())]
    pub commit_once_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct Incremented {
    pub counter: Pubkey,
    pub count: u64,
    pub slot: u64,
    pub actor: Pubkey,
}

#[error_code]
pub enum DemoCounterError {
    #[msg("Counter overflowed")]
    Overflow,
}
