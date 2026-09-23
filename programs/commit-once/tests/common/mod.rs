//! Shared harness for the CommitOnce program test suite.
//!
//! Every test in this suite executes the **real compiled SBF program** through LiteSVM.
//! Nothing here re-implements program logic: the program under test is the same `.so`
//! that gets deployed, loaded from `target/deploy/`.
//!
//! The suite is deliberately written against observable onchain state (account data,
//! lamport balances, counter values) rather than against returned error strings, so a
//! test can only pass if the business action genuinely did or did not happen.

#![allow(dead_code)]

use {
    anchor_lang::{
        prelude::{pubkey, Pubkey},
        solana_program::instruction::{AccountMeta, Instruction},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::{types::TransactionResult, LiteSVM},
    sha2::{Digest, Sha256},
    solana_address_lookup_table_interface::instruction::{
        create_lookup_table, extend_lookup_table,
    },
    solana_clock::Clock,
    solana_keypair::Keypair,
    solana_message::{v0, AddressLookupTableAccount, Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    solana_transaction_error::TransactionError,
    std::path::PathBuf,
};

pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

/// Mainnet rent rate in lamports per byte, since SIMD-0437 step 2 (epoch 1033).
///
/// Verified against the live `SysvarRent` account on mainnet, testnet and devnet:
/// `lamports_per_byte = 5080`, `exemption_threshold = 1.0`, `burn_percent = 50`.
///
/// This constant exists because the `solana-rent` crate still ships
/// `DEFAULT_LAMPORTS_PER_BYTE_YEAR = 3480` with `DEFAULT_EXEMPTION_THRESHOLD = 2.0`,
/// i.e. an effective 6960 lamports/byte — **37% higher than reality**. LiteSVM takes
/// its default rent from that stale crate constant, so the harness overrides the
/// `SysvarRent` sysvar to the real mainnet values. Without this, every rent figure
/// reported by the test suite would be wrong by more than a third.
pub const MAINNET_LAMPORTS_PER_BYTE: u64 = 5080;

/// Mainnet rent burn percentage.
pub const MAINNET_BURN_PERCENT: u8 = 50;

/// A `Rent` sysvar matching live mainnet.
#[allow(deprecated)] // the crate fields are deprecated in favour of a v4 rename
pub fn mainnet_rent() -> solana_rent::Rent {
    let mut rent = solana_rent::Rent::default();
    rent.lamports_per_byte_year = MAINNET_LAMPORTS_PER_BYTE;
    rent.exemption_threshold = 1.0;
    rent.burn_percent = MAINNET_BURN_PERCENT;
    rent
}

/// Rent-exempt minimum for `data_len` bytes at mainnet rates, computed independently of
/// the SVM so tests can assert against a hand-derived figure.
pub const ACCOUNT_STORAGE_OVERHEAD: u64 = 128;

pub fn mainnet_rent_exempt_minimum(data_len: u64) -> u64 {
    (ACCOUNT_STORAGE_OVERHEAD + data_len) * MAINNET_LAMPORTS_PER_BYTE
}

/// Rent-exempt deposit a `claim` creates for its receipt: `(202 + 128) * 5080`.
pub const RECEIPT_RENT_LAMPORTS: u64 = 1_676_400;

/// Anchor numbers custom program errors from 6000 upwards, in enum declaration order.
/// These mirror `CommitOnceError` and are asserted against the generated IDL by
/// `tests/errors.rs`.
pub const E_ALREADY_COMMITTED: u32 = 6000;
pub const E_IDEMPOTENCY_CONFLICT: u32 = 6001;
pub const E_DURABLE_NONCE_UNSUPPORTED: u32 = 6002;
pub const E_INVALID_RETENTION: u32 = 6003;
pub const E_INVALID_REFUND_DESTINATION: u32 = 6004;
pub const E_INVALID_RECEIPT_OWNER: u32 = 6005;
pub const E_INVALID_RECEIPT_DATA: u32 = 6006;
pub const E_INVALID_RECEIPT_AUTHORITY: u32 = 6007;
pub const E_UNSUPPORTED_RECEIPT_VERSION: u32 = 6008;
pub const E_RECEIPT_NOT_EXPIRED: u32 = 6009;
pub const E_RECEIPT_IS_PERMANENT: u32 = 6010;
pub const E_INSTRUCTION_SCAN_INCONCLUSIVE: u32 = 6011;

pub const HOUR: u64 = 60 * 60;
pub const DAY: u64 = 24 * HOUR;

/// Program-declared retention bounds, re-exported so tests read them from the single
/// source of truth rather than restating the numbers.
pub const MIN_RETENTION: u64 = commit_once::MIN_RETENTION_SECONDS;

/// Re-exported so tests can reason about the durable-nonce scan bound directly.
pub const MAX_INSTRUCTION_SCAN: usize = commit_once::MAX_INSTRUCTION_SCAN;
pub const MAX_RETENTION: u64 = commit_once::MAX_RETENTION_SECONDS;

/// Domain-separated hashing. These prefixes are the cross-language contract with the
/// TypeScript SDK; `tests/vectors.rs` pins them to fixed hex so that neither side can
/// drift silently.
pub const NS_PREFIX: &[u8] = b"commitonce/namespace/v1";
pub const KEY_PREFIX: &[u8] = b"commitonce/key/v1";

pub fn namespace_hash(namespace: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(NS_PREFIX);
    h.update(namespace.as_bytes());
    h.finalize().into()
}

pub fn idempotency_key_hash(key: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(KEY_PREFIX);
    h.update(key.as_bytes());
    h.finalize().into()
}

pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().into()
}

// ---------------------------------------------------------------------------
// The demo-counter program's wire interface
//
// Deliberately hardcoded rather than imported from the `demo-counter` crate, for two
// reasons:
//
//  1. Both are Anchor programs and both export an `entrypoint` symbol, so linking the
//     crate into this test binary is a duplicate-symbol link error.
//  2. Encoding the interface by hand means these tests exercise the bytes that actually
//     go over the wire, instead of a shared Rust abstraction that could hide a mismatch
//     between the two programs.
//
// Discriminators are `sha256("<namespace>:<name>")[0..8]`; `tests/wire_format.rs`
// recomputes them from scratch and fails if these constants drift.
// ---------------------------------------------------------------------------

/// Program ID derived from `deploy-keys/demo_counter-keypair.json`.
pub const DEMO_COUNTER_ID: Pubkey = pubkey!("EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5");

/// PDA seed prefix for the demo counter.
pub const COUNTER_SEED: &[u8] = b"counter";

/// `sha256("global:initialize")[0..8]`.
pub const INITIALIZE_DISCRIMINATOR: [u8; 8] = [175, 175, 109, 31, 13, 152, 155, 237];

/// `sha256("global:increment")[0..8]`.
pub const INCREMENT_DISCRIMINATOR: [u8; 8] = [11, 18, 104, 9, 104, 174, 59, 33];

/// `sha256("global:increment_guarded")[0..8]`.
///
/// The CPI variant: `demo-counter` calls `commit_once::claim` itself rather than relying on the
/// client to prepend it. See `tests/cpi.rs`.
pub const INCREMENT_GUARDED_DISCRIMINATOR: [u8; 8] = [43, 71, 68, 84, 51, 44, 223, 192];

/// `sha256("account:Counter")[0..8]`.
pub const COUNTER_ACCOUNT_DISCRIMINATOR: [u8; 8] = [255, 176, 4, 245, 188, 253, 124, 25];

/// `8 discriminator | 32 owner | 8 count | 8 last_slot | 32 last_actor`.
pub const COUNTER_ACCOUNT_LEN: usize = 88;

/// Byte offset of `count` inside a serialized `Counter`.
pub const COUNTER_COUNT_OFFSET: usize = 8 + 32;

// ---------------------------------------------------------------------------
// Program artifact loading
// ---------------------------------------------------------------------------

/// Directory holding the compiled `.so` files produced by `anchor build`.
pub fn deploy_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("COMMIT_ONCE_DEPLOY_DIR") {
        return PathBuf::from(dir);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy")
}

pub fn program_bytes(name: &str) -> Vec<u8> {
    let path = deploy_dir().join(format!("{name}.so"));
    std::fs::read(&path).unwrap_or_else(|e| {
        panic!(
            "could not read compiled program artifact at {}\n  {e}\n\n\
             Build the programs first:\n    bash scripts/build.sh\n\
             or point COMMIT_ONCE_DEPLOY_DIR at the directory containing the .so files.",
            path.display()
        )
    })
}

// ---------------------------------------------------------------------------
// Deterministic receipt derivation (mirrors the onchain PDA seeds)
// ---------------------------------------------------------------------------

pub fn derive_receipt(
    authority: &Pubkey,
    namespace_hash: &[u8; 32],
    idempotency_key_hash: &[u8; 32],
) -> Pubkey {
    Pubkey::find_program_address(
        &[
            commit_once::RECEIPT_SEED,
            authority.as_ref(),
            namespace_hash.as_ref(),
            idempotency_key_hash.as_ref(),
        ],
        &commit_once::id(),
    )
    .0
}

// ---------------------------------------------------------------------------
// Instruction builders
// ---------------------------------------------------------------------------

pub struct ClaimArgs {
    pub authority: Pubkey,
    pub namespace_hash: [u8; 32],
    pub idempotency_key_hash: [u8; 32],
    pub payload_hash: [u8; 32],
    pub retention_seconds: u64,
    pub refund_destination: Pubkey,
}

impl ClaimArgs {
    /// A claim with sane defaults: 24h retention, refund to the authority.
    pub fn new(authority: Pubkey, namespace: &str, key: &str, payload_hash: [u8; 32]) -> Self {
        Self {
            authority,
            namespace_hash: namespace_hash(namespace),
            idempotency_key_hash: idempotency_key_hash(key),
            payload_hash,
            retention_seconds: 24 * HOUR,
            refund_destination: authority,
        }
    }

    pub fn retention(mut self, seconds: u64) -> Self {
        self.retention_seconds = seconds;
        self
    }

    pub fn refund_to(mut self, destination: Pubkey) -> Self {
        self.refund_destination = destination;
        self
    }

    pub fn payload(mut self, payload_hash: [u8; 32]) -> Self {
        self.payload_hash = payload_hash;
        self
    }

    pub fn receipt(&self) -> Pubkey {
        derive_receipt(
            &self.authority,
            &self.namespace_hash,
            &self.idempotency_key_hash,
        )
    }

    pub fn instruction(&self) -> Instruction {
        Instruction::new_with_bytes(
            commit_once::id(),
            &commit_once::instruction::Claim {
                namespace_hash: self.namespace_hash,
                idempotency_key_hash: self.idempotency_key_hash,
                payload_hash: self.payload_hash,
                retention_seconds: self.retention_seconds,
                refund_destination: self.refund_destination,
            }
            .data(),
            commit_once::accounts::Claim {
                authority: self.authority,
                receipt: self.receipt(),
                instructions_sysvar: solana_instructions_sysvar::ID,
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
        )
    }
}

pub fn close_receipt_ix(receipt: Pubkey, refund_destination: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        commit_once::id(),
        &commit_once::instruction::CloseReceipt {}.data(),
        commit_once::accounts::CloseReceipt {
            receipt,
            refund_destination,
        }
        .to_account_metas(None),
    )
}

pub fn increment_ix(owner: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        DEMO_COUNTER_ID,
        &INCREMENT_DISCRIMINATOR,
        vec![
            AccountMeta::new(counter_pda(&owner), false),
            AccountMeta::new(owner, true),
        ],
    )
}

pub fn initialize_counter_ix(owner: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        DEMO_COUNTER_ID,
        &INITIALIZE_DISCRIMINATOR,
        vec![
            AccountMeta::new(counter_pda(&owner), false),
            AccountMeta::new(owner, true),
            AccountMeta::new_readonly(anchor_lang::system_program::ID, false),
        ],
    )
}

pub fn counter_pda(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[COUNTER_SEED, owner.as_ref()], &DEMO_COUNTER_ID).0
}

/// Build `demo_counter::increment_guarded`, which calls `commit_once::claim` through a CPI.
///
/// Accounts, in the order the program declares them: counter, owner, receipt,
/// instructions_sysvar, commit_once_program, system_program.
pub fn increment_guarded_ix(args: &ClaimArgs) -> Instruction {
    let owner = args.authority;
    let mut data = Vec::with_capacity(8 + 32 * 3 + 8);
    data.extend_from_slice(&INCREMENT_GUARDED_DISCRIMINATOR);
    data.extend_from_slice(&args.namespace_hash);
    data.extend_from_slice(&args.idempotency_key_hash);
    data.extend_from_slice(&args.payload_hash);
    data.extend_from_slice(&args.retention_seconds.to_le_bytes());

    Instruction::new_with_bytes(
        DEMO_COUNTER_ID,
        &data,
        vec![
            AccountMeta::new(counter_pda(&owner), false),
            AccountMeta::new(owner, true),
            AccountMeta::new(args.receipt(), false),
            AccountMeta::new_readonly(solana_instructions_sysvar::ID, false),
            AccountMeta::new_readonly(commit_once::id(), false),
            AccountMeta::new_readonly(anchor_lang::system_program::ID, false),
        ],
    )
}

/// A plain SOL transfer, used as a dependency-free "business action".
pub fn transfer_ix(from: Pubkey, to: Pubkey, lamports: u64) -> Instruction {
    solana_system_interface::instruction::transfer(&from, &to, lamports)
}

/// The Compute Budget program.
pub const COMPUTE_BUDGET_ID: Pubkey = pubkey!("ComputeBudget111111111111111111111111111111");

/// `ComputeBudgetInstruction::SetComputeUnitPrice` — enum variant 3, then a `u64` LE price.
///
/// Hand-encoded to avoid a dependency. This is how the suite models the most common way a
/// rebuilt transaction differs from its predecessor: a client that raises its priority fee
/// after a slow confirmation produces different bytes, a different message hash and
/// therefore a different signature — so network-level deduplication cannot connect it to
/// the original attempt.
pub fn set_compute_unit_price_ix(micro_lamports: u64) -> Instruction {
    let mut data = [0u8; 9];
    data[0] = 3;
    data[1..].copy_from_slice(&micro_lamports.to_le_bytes());
    Instruction::new_with_bytes(COMPUTE_BUDGET_ID, &data, vec![])
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

pub struct Env {
    pub svm: LiteSVM,
    /// Fee payer and, by default, the intent authority.
    pub authority: Keypair,
    /// A second funded keypair used to act as an unrelated third party.
    pub stranger: Keypair,
}

impl Default for Env {
    fn default() -> Self {
        Self::new()
    }
}

impl Env {
    pub fn new() -> Self {
        let mut svm = LiteSVM::new();

        // LiteSVM seeds the Rent sysvar from a stale crate constant (effective 6960
        // lamports/byte). Override it with live mainnet values *before* anything is
        // loaded or created, so every rent figure this suite observes is real.
        svm.set_sysvar(&mainnet_rent());

        svm.add_program(commit_once::id(), &program_bytes("commit_once"))
            .expect("failed to load commit_once program");
        svm.add_program(DEMO_COUNTER_ID, &program_bytes("demo_counter"))
            .expect("failed to load demo_counter program");

        let authority = Keypair::new();
        let stranger = Keypair::new();
        svm.airdrop(&authority.pubkey(), 100 * LAMPORTS_PER_SOL)
            .expect("airdrop failed");
        svm.airdrop(&stranger.pubkey(), 100 * LAMPORTS_PER_SOL)
            .expect("airdrop failed");

        Self {
            svm,
            authority,
            stranger,
        }
    }

    pub fn authority_pubkey(&self) -> Pubkey {
        self.authority.pubkey()
    }

    /// Build, sign and submit a transaction with an explicit fee payer.
    pub fn send_as(
        &mut self,
        payer: &Keypair,
        instructions: &[Instruction],
        extra_signers: &[&Keypair],
    ) -> TransactionResult {
        let blockhash = self.svm.latest_blockhash();
        self.send_with_blockhash(payer, instructions, extra_signers, blockhash)
    }

    pub fn send_with_blockhash(
        &mut self,
        payer: &Keypair,
        instructions: &[Instruction],
        extra_signers: &[&Keypair],
        blockhash: solana_hash::Hash,
    ) -> TransactionResult {
        let message = Message::new_with_blockhash(instructions, Some(&payer.pubkey()), &blockhash);
        let mut signers: Vec<&Keypair> = vec![payer];
        signers.extend_from_slice(extra_signers);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(message), &signers)
            .expect("failed to sign transaction");
        self.svm.send_transaction(tx)
    }

    /// Submit as the authority (the common case).
    pub fn send(&mut self, instructions: &[Instruction]) -> TransactionResult {
        self.send_signed(instructions, &[])
    }

    /// Submit as the authority, with additional signers.
    pub fn send_signed(
        &mut self,
        instructions: &[Instruction],
        extra_signers: &[&Keypair],
    ) -> TransactionResult {
        let blockhash = self.svm.latest_blockhash();
        self.send_signed_with_blockhash(instructions, extra_signers, blockhash)
    }

    /// Submit as the authority with a distinct priority fee prepended.
    ///
    /// LiteSVM's status cache deduplicates on signature, and it accepts only one recent
    /// blockhash at a time, so re-submitting the same instruction list twice in a row
    /// would be rejected as `AlreadyProcessed` before the program ever runs. Varying the
    /// priority fee produces a genuinely different transaction — which is also how real
    /// clients differ between attempts — so the *program's* behaviour is what gets tested.
    pub fn send_distinct(&mut self, instructions: &[Instruction], bump: u64) -> TransactionResult {
        let mut ixs = vec![set_compute_unit_price_ix(1_000 + bump)];
        ixs.extend_from_slice(instructions);
        self.send(&ixs)
    }

    // -----------------------------------------------------------------------------------
    // v0 messages and address lookup tables.
    //
    // Everything else in this harness builds `VersionedMessage::Legacy`. Production clients
    // mostly do not: v0 with an address lookup table is how a transaction fits inside the
    // 1232-byte packet limit once it touches more than a handful of accounts. Whether the
    // guard survives that shape is a real compatibility question, and it was previously
    // recorded as "expected to work, but not verified".
    // -----------------------------------------------------------------------------------

    /// Create an address lookup table containing `addresses`, and warm it.
    ///
    /// **The warmup is the point.** Solana refuses to resolve a table that was extended in
    /// the *current* slot, so a table built and used in the same slot fails with
    /// `AddressLookupTableAccountNotFound` or an "extended in the same slot" error. That is
    /// the single most common reason a v0 transaction fails the first time it is tried, and
    /// it is why this helper warps forward instead of returning immediately.
    pub fn create_lookup_table(&mut self, addresses: &[Pubkey]) -> Pubkey {
        let authority = self.authority.pubkey();
        let clock: Clock = self.svm.get_sysvar();

        let (create_ix, table) = create_lookup_table(authority, authority, clock.slot);
        assert_success(&self.send(&[create_ix]));

        let extend_ix = extend_lookup_table(table, authority, Some(authority), addresses.to_vec());
        assert_success(&self.send(&[extend_ix]));

        // Move past the slot the table was extended in, or the runtime will refuse it.
        self.svm.warp_to_slot(clock.slot + 2);
        table
    }

    /// Build, sign and submit a **v0** transaction resolving `lookup_addresses` via a table.
    ///
    /// Signers must stay in the static keys — a lookup table cannot supply a signer — so the
    /// authority remains a static account and only the non-signer accounts are loaded.
    pub fn send_v0(
        &mut self,
        instructions: &[Instruction],
        lookup_table: Pubkey,
        lookup_addresses: &[Pubkey],
    ) -> TransactionResult {
        let blockhash = self.svm.latest_blockhash();
        self.send_v0_with_blockhash(instructions, lookup_table, lookup_addresses, blockhash)
    }

    /// As [`Self::send_v0`], but against an explicit blockhash so a retry can be modelled.
    pub fn send_v0_with_blockhash(
        &mut self,
        instructions: &[Instruction],
        lookup_table: Pubkey,
        lookup_addresses: &[Pubkey],
        blockhash: solana_hash::Hash,
    ) -> TransactionResult {
        let tx = self.build_v0(instructions, lookup_table, lookup_addresses, blockhash);
        self.svm.send_transaction(tx)
    }

    /// Build and sign a v0 transaction without submitting it.
    pub fn build_v0(
        &mut self,
        instructions: &[Instruction],
        lookup_table: Pubkey,
        lookup_addresses: &[Pubkey],
        blockhash: solana_hash::Hash,
    ) -> VersionedTransaction {
        let table = AddressLookupTableAccount {
            key: lookup_table,
            addresses: lookup_addresses.to_vec(),
        };
        let message =
            v0::Message::try_compile(&self.authority.pubkey(), instructions, &[table], blockhash)
                .expect("failed to compile a v0 message");
        VersionedTransaction::try_new(VersionedMessage::V0(message), &[&self.authority])
            .expect("failed to sign the v0 transaction")
    }

    /// Build and sign a transaction without submitting it.
    ///
    /// Tests that need to prove "two attempts produced two *different signed
    /// transactions*" build both up front and compare their signatures, rather than
    /// inferring that from a submission result.
    pub fn build_signed_with_blockhash(
        &mut self,
        payer: &Keypair,
        instructions: &[Instruction],
        extra_signers: &[&Keypair],
        blockhash: solana_hash::Hash,
    ) -> VersionedTransaction {
        let message = Message::new_with_blockhash(instructions, Some(&payer.pubkey()), &blockhash);
        let mut signers: Vec<&Keypair> = vec![payer];
        signers.extend_from_slice(extra_signers);
        VersionedTransaction::try_new(VersionedMessage::Legacy(message), &signers)
            .expect("failed to sign transaction")
    }

    /// Build and sign as the authority, without submitting.
    pub fn build(
        &mut self,
        instructions: &[Instruction],
        extra_signers: &[&Keypair],
        blockhash: solana_hash::Hash,
    ) -> VersionedTransaction {
        let message =
            Message::new_with_blockhash(instructions, Some(&self.authority.pubkey()), &blockhash);
        let mut signers: Vec<&Keypair> = vec![&self.authority];
        signers.extend_from_slice(extra_signers);
        VersionedTransaction::try_new(VersionedMessage::Legacy(message), &signers)
            .expect("failed to sign transaction")
    }

    /// Rebuild and re-sign a transaction against an explicit blockhash.
    ///
    /// This is how the suite models a retry: the caller keeps the same instruction
    /// list but the blockhash differs, so the message bytes and therefore the
    /// signature differ.
    pub fn send_signed_with_blockhash(
        &mut self,
        instructions: &[Instruction],
        extra_signers: &[&Keypair],
        blockhash: solana_hash::Hash,
    ) -> TransactionResult {
        let tx = self.build(instructions, extra_signers, blockhash);
        self.svm.send_transaction(tx)
    }

    pub fn account_exists(&self, address: &Pubkey) -> bool {
        self.svm
            .get_account(address)
            .map(|a| !a.data.is_empty() || a.lamports > 0)
            .unwrap_or(false)
    }

    pub fn lamports(&self, address: &Pubkey) -> u64 {
        self.svm
            .get_account(address)
            .map(|a| a.lamports)
            .unwrap_or(0)
    }

    pub fn read_receipt(&self, address: &Pubkey) -> commit_once::state::IntentReceipt {
        let account = self
            .svm
            .get_account(address)
            .unwrap_or_else(|| panic!("no account at receipt {address}"));
        let mut data: &[u8] = &account.data;
        commit_once::state::IntentReceipt::try_deserialize(&mut data)
            .expect("account at receipt PDA is not a valid IntentReceipt")
    }

    /// The deterministic business-side effect: how many times the counter incremented.
    ///
    /// Parsed straight out of the account bytes rather than through a generated type, so
    /// the assertion depends on what the program actually wrote.
    pub fn counter_value(&self, owner: &Pubkey) -> u64 {
        let pda = counter_pda(owner);
        let account = self
            .svm
            .get_account(&pda)
            .unwrap_or_else(|| panic!("counter not initialized for {owner}"));
        assert_eq!(
            account.data.len(),
            COUNTER_ACCOUNT_LEN,
            "counter account has an unexpected size"
        );
        assert_eq!(
            &account.data[0..8],
            &COUNTER_ACCOUNT_DISCRIMINATOR[..],
            "account at the counter PDA is not a Counter"
        );
        u64::from_le_bytes(
            account.data[COUNTER_COUNT_OFFSET..COUNTER_COUNT_OFFSET + 8]
                .try_into()
                .expect("count slice"),
        )
    }

    pub fn clock(&self) -> solana_clock::Clock {
        self.svm.get_sysvar::<solana_clock::Clock>()
    }

    /// Advance both the slot and the wall clock, as a real cluster would.
    pub fn advance(&mut self, slots: u64, seconds: i64) {
        let mut clock = self.svm.get_sysvar::<solana_clock::Clock>();
        clock.slot = clock.slot.saturating_add(slots);
        clock.unix_timestamp = clock.unix_timestamp.saturating_add(seconds);
        self.svm.set_sysvar(&clock);
    }

    pub fn set_slot(&mut self, slot: u64) {
        self.svm.warp_to_slot(slot);
    }

    pub fn set_unix_timestamp(&mut self, ts: i64) {
        let mut clock = self.svm.get_sysvar::<solana_clock::Clock>();
        clock.unix_timestamp = ts;
        self.svm.set_sysvar(&clock);
    }

    pub fn rent_for(&self, data_len: usize) -> u64 {
        self.svm.minimum_balance_for_rent_exemption(data_len)
    }

    /// Mint a fresh funded keypair that is unrelated to the authority.
    pub fn fresh_funded(&mut self, sol: u64) -> Keypair {
        let kp = Keypair::new();
        self.svm
            .airdrop(&kp.pubkey(), sol * LAMPORTS_PER_SOL)
            .expect("airdrop failed");
        kp
    }
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/// Assert that a transaction failed with a specific Anchor custom error code.
pub fn assert_custom_error(result: &TransactionResult, expected: u32) {
    match result {
        Ok(meta) => panic!(
            "expected failure with custom error {expected}, but the transaction SUCCEEDED.\nlogs:\n{}",
            meta.pretty_logs()
        ),
        Err(failed) => match &failed.err {
            TransactionError::InstructionError(
                _,
                solana_instruction::error::InstructionError::Custom(code),
            ) => {
                assert_eq!(
                    *code, expected,
                    "wrong custom error code.\nlogs:\n{}",
                    failed.meta.pretty_logs()
                );
            }
            other => panic!(
                "expected custom error {expected}, got {other:?}\nlogs:\n{}",
                failed.meta.pretty_logs()
            ),
        },
    }
}

pub fn assert_success(result: &TransactionResult) -> u64 {
    match result {
        Ok(meta) => meta.compute_units_consumed,
        Err(failed) => panic!(
            "expected success, transaction failed: {:?}\nlogs:\n{}",
            failed.err,
            failed.meta.pretty_logs()
        ),
    }
}

/// Write a test-visible log block. Useful when a scenario needs narration in CI output.
pub fn banner(title: &str) {
    println!("\n===== {title} =====");
}
