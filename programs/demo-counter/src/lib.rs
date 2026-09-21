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
