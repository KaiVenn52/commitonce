//! Security properties: who can and cannot affect a receipt, and what the program
//! refuses to trust.
//!
//! These are the tests that back the claims in `docs/SECURITY_MODEL.md`. In particular,
//! `third_party_cannot_consume_another_authoritys_key` is the test that separates
//! CommitOnce from prior art whose key space is not authority-scoped.

mod common;

use anchor_lang::prelude::Pubkey;
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

/// The griefing test.
///
/// A malicious third party who learns the victim's namespace and idempotency key must
/// not be able to consume it. Because the authority is part of the receipt derivation,
/// the attacker's claim lands on a *different* PDA and leaves the victim's key intact.
#[test]
fn third_party_cannot_consume_another_authoritys_key() {
    banner("grief resistance: authority-scoped keys cannot be squatted");
    let mut env = Env::new();
    let victim = env.authority_pubkey();
    let attacker = env.fresh_funded(10);
    let attacker_pubkey = attacker.pubkey();

    assert_success(&env.send(&[initialize_counter_ix(victim)]));
    // The counter's owner must sign, so this one is submitted by `attacker`.
    assert_success(&env.send_as(&attacker, &[initialize_counter_ix(attacker_pubkey)], &[]));

    // The attacker knows the victim's namespace and key exactly.
    let namespace = "payments:transfer";
    let key = "order_928";
    let payload = sha256(b"send 10 USDC to Alice");

    let attack = ClaimArgs::new(attacker_pubkey, namespace, key, payload);
    let victim_claim = ClaimArgs::new(victim, namespace, key, payload);

    assert_ne!(attack.receipt(), victim_claim.receipt());

    // The attacker front-runs the victim and consumes their own receipt.
    assert_success(&env.send_as(
        &attacker,
        &[
            set_compute_unit_price_ix(1_000),
            attack.instruction(),
            increment_ix(attacker_pubkey),
        ],
        &[],
    ));
    assert_eq!(env.counter_value(&attacker_pubkey), 1);

    // The victim's intent is completely unaffected.
    assert_success(&env.send(&[victim_claim.instruction(), increment_ix(victim)]));
    assert_eq!(
        env.counter_value(&victim),
        1,
        "a third party must not be able to block the victim's intent"
    );

    // And the victim's receipt is genuinely theirs.
    let stored = env.read_receipt(&victim_claim.receipt());
    assert_eq!(stored.authority, victim);
}

/// A caller cannot point `claim` at somebody else's receipt PDA: the seeds constraint
/// binds the receipt address to the authority that is actually signing.
#[test]
fn receipt_pda_cannot_be_substituted_across_authorities() {
    let mut env = Env::new();
    let victim = env.authority_pubkey();
    let attacker = env.fresh_funded(10);

    let victim_claim = ClaimArgs::new(victim, "ns", "k", sha256(b"payload"));
    assert_success(&env.send(&[victim_claim.instruction()]));

    // Attacker claims the same key but tries to write to the victim's receipt PDA.
    let forged = ClaimArgs::new(attacker.pubkey(), "ns", "k", sha256(b"payload"));
    let attacker_receipt = forged.receipt();
    assert_ne!(attacker_receipt, victim_claim.receipt());

    // Hand-build the instruction with the victim's PDA substituted in.
    let mut ix = forged.instruction();
    for meta in ix.accounts.iter_mut() {
        if meta.pubkey == attacker_receipt {
            meta.pubkey = victim_claim.receipt();
        }
    }

    let res = env.send_as(&attacker, &[ix], &[]);
    assert!(res.is_err(), "a substituted receipt PDA must be rejected");

    // The victim's receipt is untouched.
    assert_eq!(env.read_receipt(&victim_claim.receipt()).authority, victim);
}

/// An account at the receipt address that is not owned by this program must never be
/// treated as a receipt. Without this check a third party could plant data there.
#[test]
fn receipt_with_foreign_owner_is_rejected() {
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    let claim = ClaimArgs::new(authority, "ns", "k", sha256(b"payload"));
    let receipt = claim.receipt();

    // Plant an account at the PDA owned by somebody else.
    let foreign_owner = Pubkey::new_unique();
    env.svm
        .set_account(
            receipt,
            solana_account::Account {
                lamports: env.rent_for(64),
                data: vec![7u8; 64],
                owner: foreign_owner,
                executable: false,
                rent_epoch: 0,
            },
        )
        .expect("set_account");

    let res = env.send(&[claim.instruction()]);
    assert_custom_error(&res, E_INVALID_RECEIPT_OWNER);
}

/// Garbage at the receipt address must fail closed, not be misinterpreted.
#[test]
fn malformed_receipt_data_is_rejected() {
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    let claim = ClaimArgs::new(authority, "ns", "k", sha256(b"payload"));
    let receipt = claim.receipt();

    assert_success(&env.send(&[claim.instruction()]));

    // Corrupt the account: wrong discriminator, wrong contents.
    let mut account = env.svm.get_account(&receipt).expect("receipt exists");
    account.data.iter_mut().for_each(|b| *b = 0xFF);
    env.svm.set_account(receipt, account).expect("set_account");

    let res = env.send(&[claim.instruction()]);
    assert!(
        res.is_err(),
        "a receipt with a corrupt discriminator must not be accepted"
    );
}

/// A receipt written by a future program version must be refused rather than
/// reinterpreted under the current layout.
#[test]
fn unsupported_receipt_version_is_rejected() {
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    let claim = ClaimArgs::new(authority, "ns", "k", sha256(b"payload"));
    let receipt = claim.receipt();

    assert_success(&env.send(&[claim.instruction()]));

    let mut account = env.svm.get_account(&receipt).expect("receipt exists");
    // First byte after the 8-byte Anchor discriminator is `version`.
    account.data[8] = 99;
    env.svm.set_account(receipt, account).expect("set_account");

    let res = env.send_distinct(&[claim.instruction()], 3);
    assert_custom_error(&res, E_UNSUPPORTED_RECEIPT_VERSION);
}

#[test]
fn refund_destination_cannot_be_the_default_pubkey() {
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    let claim = ClaimArgs::new(authority, "ns", "k", sha256(b"payload"))
        .refund_to(Pubkey::default());

    let res = env.send(&[claim.instruction()]);
    assert_custom_error(&res, E_INVALID_REFUND_DESTINATION);
    assert!(!env.account_exists(&claim.receipt()));
}

#[test]
fn refund_destination_cannot_be_the_receipt_itself() {
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    let mut claim = ClaimArgs::new(authority, "ns", "k", sha256(b"payload"));
    claim.refund_destination = claim.receipt();

    let res = env.send(&[claim.instruction()]);
    assert_custom_error(&res, E_INVALID_REFUND_DESTINATION);
}

// ---------------------------------------------------------------------------
// Durable nonce policy
// ---------------------------------------------------------------------------

/// Build a transaction that carries a real System Program `AdvanceNonceAccount`
/// instruction at index 0 — the position a durable-nonce transaction must use — followed
/// by the instructions under test.
///
/// **What LiteSVM can and cannot express here.** A *genuine* durable-nonce transaction
/// cannot be constructed in LiteSVM 0.10.0, and the reason is worth recording because it
/// cost real debugging time. The System Program refuses to advance a nonce whose stored
/// value already equals `DurableNonce::from_blockhash(env.blockhash)` — *"nonce can only
/// advance once per slot"* — while the runtime only accepts a nonce transaction when the
/// stored value equals `DurableNonce::from_blockhash(message.recent_blockhash)`. On a real
/// cluster those two conditions are compatible, because `env.blockhash` is the *bank's*
/// latest blockhash and differs from the message's. LiteSVM instead passes the
/// **transaction's own** blockhash into `EnvironmentConfig::new(*blockhash, …)`, making the
/// conditions mutually exclusive: `stored == from_blockhash(msg_bh)` and
/// `stored != from_blockhash(env_bh)` cannot both hold when `msg_bh == env_bh`.
///
/// So this harness cannot produce a transaction the runtime *classifies* as a nonce
/// transaction. What it can do — and what the program actually inspects — is include the
/// marker instruction in the transaction, which `claim` finds by scanning the Instructions
/// sysvar. The tests below therefore assert the program's deliberately stricter behaviour:
/// the **presence** of the marker triggers the policy, whether or not the runtime would
/// have treated the transaction as a nonce transaction.
///
/// The blockhash is expired after creating the nonce account for two reasons: it lets the
/// advance execute successfully, so the transaction under test completes rather than
/// aborting on an unrelated System Program error, and it keeps the message's blockhash
/// equal to the cluster's current one, so this stays an ordinary transaction.
fn durable_nonce_ixs(
    env: &mut Env,
    trailing: &[solana_instruction::Instruction],
) -> Vec<solana_instruction::Instruction> {
    let authority = env.authority.pubkey();
    let nonce = Keypair::new();

    let create = solana_system_interface::instruction::create_nonce_account(
        &authority,
        &nonce.pubkey(),
        &authority,
        env.rent_for(80),
    );
    env.send_signed(&create, &[&nonce])
        .expect("create nonce account");

    // Move to a fresh blockhash: the nonce stored at creation is derived from the old one,
    // so the advance below is permitted.
    env.svm.expire_blockhash();

    let mut ixs = vec![solana_system_interface::instruction::advance_nonce_account(
        &nonce.pubkey(),
        &authority,
    )];
    ixs.extend_from_slice(trailing);
    ixs
}

/// A durable-nonce transaction never expires, so a receipt with a finite retention could
/// be cleaned up while an old signed duplicate is still executable. That would silently
/// reopen the duplicate window, so it is refused.
#[test]
fn durable_nonce_transaction_is_rejected_for_finite_retention() {
    banner("durable nonce: refused for finite retention");
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let claim = ClaimArgs::new(authority, "ns", "nonce_case", sha256(b"payload"))
        .retention(MIN_RETENTION);

    let ixs = durable_nonce_ixs(&mut env, &[claim.instruction(), increment_ix(authority)]);
    let res = env.send(&ixs);

    // The advance at index 0 executes first and succeeds, so the error below is genuinely
    // CommitOnce's policy check and not an unrelated System Program failure in the harness.
    assert_custom_error(&res, E_DURABLE_NONCE_UNSUPPORTED);
    assert!(!env.account_exists(&claim.receipt()));
    assert_eq!(env.counter_value(&authority), 0);
}

/// A permanent receipt has no cleanup path, so no signed duplicate can ever be resurrected
/// by cleanup. Combining it with a durable nonce is therefore safe and explicitly allowed.
#[test]
fn durable_nonce_transaction_is_allowed_for_permanent_retention() {
    banner("durable nonce: allowed for permanent retention");
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let claim =
        ClaimArgs::new(authority, "ns", "nonce_permanent", sha256(b"payload")).retention(0);

    let ixs = durable_nonce_ixs(&mut env, &[claim.instruction(), increment_ix(authority)]);
    let res = env.send(&ixs);

    assert_success(&res);
    assert_eq!(env.counter_value(&authority), 1);
    assert!(env.read_receipt(&claim.receipt()).is_permanent());
}

/// **A pre-funded receipt PDA must not permanently block an intent.**
///
/// The attack is cheap and needs nothing secret. A receipt PDA is derived from
/// `(authority, namespace, key)`, and a namespace and key are typically semi-public — an
/// order id, a job id, a checkout reference. So an attacker who learns them can compute the
/// victim's receipt address and send it **one lamport**.
///
/// That creates a system-owned account with lamports and *no data*. `claim` decides a receipt
/// is absent with `data_is_empty()`, which is true for such an account, so it takes the
/// create path — and `SystemInstruction::CreateAccount` refuses an account that already holds
/// lamports. If that were the end of it, one lamport plus a fee would permanently deny the
/// victim that idempotency key, and the victim's retries would fail forever with an error that
/// has nothing to do with their intent.
///
/// `claim` therefore has to cope with a pre-funded PDA: top it up to rent-exempt, then
/// `Allocate` and `Assign` it, all signed by the PDA itself.
#[test]
fn a_prefunded_receipt_pda_does_not_block_the_intent() {
    banner("griefing: a pre-funded receipt PDA must not block the intent");
    let mut env = Env::new();
    let victim = env.authority_pubkey();
    assert_success(&env.send(&[initialize_counter_ix(victim)]));

    let attacker = env.fresh_funded(10);
    let attacker_pubkey = attacker.pubkey();

    // The attacker knows the victim's namespace and key and derives the same PDA.
    let namespace = "payments:transfer";
    let key = "order_928";
    let victim_claim = ClaimArgs::new(victim, namespace, key, sha256(b"payload"));

    // One lamport. This is the whole attack.
    assert_success(&env.send_as(
        &attacker,
        &[transfer_ix(attacker_pubkey, victim_claim.receipt(), 1)],
        &[],
    ));
    assert!(
        env.account_exists(&victim_claim.receipt()),
        "the attack must actually have created the account, or this test proves nothing"
    );

    // The victim's intent must still commit.
    let res = env.send(&[victim_claim.instruction(), increment_ix(victim)]);
    assert_success(&res);
    assert_eq!(env.counter_value(&victim), 1);

    // And the guard must work normally afterwards: the receipt is real, not just present.
    let replay = env.send_distinct(&[victim_claim.instruction(), increment_ix(victim)], 1);
    assert_custom_error(&replay, E_ALREADY_COMMITTED);
    assert_eq!(env.counter_value(&victim), 1);
}

/// The nonce scan must not fire on ordinary transactions. This guards against an
/// over-eager check that would break every normal integration.
#[test]
fn ordinary_transactions_are_not_mistaken_for_nonce_transactions() {
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    let recipient = Keypair::new().pubkey();

    // A transaction containing a *different* System Program instruction, plus a
    // CommitOnce guard, must be accepted.
    let claim = ClaimArgs::new(authority, "ns", "no_nonce", sha256(b"payload"))
        .retention(MIN_RETENTION);
    let res = env.send(&[
        claim.instruction(),
        transfer_ix(authority, recipient, 1_000_000),
    ]);
    assert_success(&res);
    assert!(env.account_exists(&claim.receipt()));
}

/// The runtime's own ceiling on how many instructions a transaction may carry.
///
/// This is enforced by the SVM, not by this program, and it is **discovered** rather than
/// hardcoded: the first version of this test asserted 64 from memory, and the runtime
/// reported the failure one index lower. A number owned by another codebase is exactly the
/// kind of thing that changes without warning, so the test probes for it and then asserts
/// the relationship that actually matters.
///
/// Returns the largest instruction count that executed successfully.
fn discover_instruction_ceiling(
    env: &mut Env,
    authority: Pubkey,
    recipient: Pubkey,
) -> usize {
    let mut largest_ok = 0usize;

    // 2 instructions is the floor: the guard plus one business instruction. 120 is well
    // past any plausible ceiling, so reaching it means something is wrong with the probe.
    for total in 2..=120usize {
        let claim = ClaimArgs::new(
            authority,
            "ns",
            &format!("ceiling_probe_{total}"),
            sha256(b"payload"),
        )
        .retention(MIN_RETENTION);

        let mut ixs: Vec<solana_instruction::Instruction> = (0..total - 2)
            .map(|_| transfer_ix(authority, recipient, 0))
            .collect();
        ixs.push(claim.instruction());
        ixs.push(increment_ix(authority));
        assert_eq!(ixs.len(), total);

        if env.send(&ixs).is_ok() {
            largest_ok = total;
        } else {
            return largest_ok;
        }
    }

    panic!("no instruction ceiling was found below 120; the probe is not measuring what it thinks");
}

/// **The scan bound must sit above the runtime's own instruction ceiling.**
///
/// `transaction_uses_durable_nonce` returns `false` when it runs off the end of the
/// instruction list, and refuses with `InstructionScanInconclusive` when it exhausts
/// `MAX_INSTRUCTION_SCAN` first. Those two outcomes are only distinguishable if the bound is
/// above the largest instruction list the runtime will execute — otherwise a padded
/// transaction could push a real `AdvanceNonceAccount` past the bound and be waved through,
/// letting a caller combine a durable nonce with a finite retention and reopen the duplicate
/// window at cleanup.
///
/// If this test ever fails, the fix is to raise `MAX_INSTRUCTION_SCAN`, not to relax the
/// assertion.
#[test]
fn scan_bound_sits_above_the_runtime_instruction_ceiling() {
    banner("durable nonce: the scan bound is above the runtime's instruction ceiling");
    let mut env = Env::new();
    let authority = env.authority_pubkey();
    assert_success(&env.send(&[initialize_counter_ix(authority)]));

    let recipient = Keypair::new().pubkey();
    assert_success(&env.send(&[transfer_ix(authority, recipient, 1_000_000)]));

    let ceiling = discover_instruction_ceiling(&mut env, authority, recipient);

    // A ceiling of 0 would mean the probe never succeeded at all, which is a broken probe
    // rather than a finding.
    assert!(
        ceiling >= 2,
        "the probe never found a transaction that executed, so it measured nothing"
    );

    assert!(
        MAX_INSTRUCTION_SCAN > ceiling,
        "MAX_INSTRUCTION_SCAN ({MAX_INSTRUCTION_SCAN}) must exceed the runtime's instruction \
         ceiling ({ceiling}), or the nonce scan can run out of budget before the instruction \
         list ends and a padded transaction could hide its nonce advance past the bound"
    );

    // And the largest transaction the runtime allows must still be scanned to completion,
    // so the bound does not cause spurious refusals at the ceiling.
    let claim = ClaimArgs::new(authority, "ns", "at_ceiling", sha256(b"payload"))
        .retention(MIN_RETENTION);
    let mut ixs: Vec<solana_instruction::Instruction> = (0..ceiling - 2)
        .map(|_| transfer_ix(authority, recipient, 0))
        .collect();
    ixs.push(claim.instruction());
    ixs.push(increment_ix(authority));
    assert_eq!(ixs.len(), ceiling);

    assert_success(&env.send(&ixs));
    assert!(env.account_exists(&claim.receipt()));
}
