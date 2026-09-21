# CommitOnce — project description

**Product name:** CommitOnce
**One line:** Idempotency keys for Solana. Retry without executing twice.
**Track:** Solana
**Repository:** this repository, Apache-2.0
**Status:** deployed and live on **devnet**; unaudited; not on mainnet; not published to npm

Everything in this document is either reproducible from the repository or read back from
chain state. Where a fact is not verified, it is not claimed. The authority on what is and is
not verified is [`EVIDENCE.md`](../EVIDENCE.md).

---

## The problem, in developer terms

A client submits a transaction. The RPC call times out. The client cannot tell whether the
transaction landed, so it retries — and a retry means *rebuilding*: fresh blockhash, a higher
priority fee because the first attempt was slow, possibly a different route, re-signed.

Solana's runtime deduplicates transactions by **message hash**. A rebuilt transaction has
different bytes, therefore a different message hash, therefore no deduplication. **Both can
land.** The payment happens twice.

This is documented, not hypothetical:

- Agave's runtime source, `runtime/src/bank.rs`: the message hash is added to the status cache
  *"to ensure that this message won't be processed again with a different signature."* That
  protects *signed bytes*. It does not protect a *logical intent*.
- Solana's official production-readiness guide states the consequence and hands the remedy
  back to the application: *"A rebuilt transaction has a new signature, so preserve
  application-level idempotency before sending it."* The same page warns that a `null` result
  from the recent signature-status cache is inconclusive — so even asking whether the first
  attempt landed is not reliable.
- Transaction-delivery vendors repeat the handoff. Helius documents that `sendTransaction`
  *"does not alter the transaction in any way"* and warns that re-signing *"can lead to
  duplicate transactions being confirmed."* Triton tells clients to *"handle retries in your
  own code."*

The layer that would let the chain answer *"has this intent already happened?"* does not exist
as a product. CommitOnce is that layer.

## The mechanism

One instruction, prepended to the transaction the caller already builds — the same atomic
transaction as the business instructions:

```text
one atomic Solana transaction
  1. commit_once::claim(namespace, idempotency_key, payload, retention)
       receipt PDA absent  -> create it, continue
       receipt PDA present -> ERROR -> the whole transaction reverts
  2. ...your existing business instructions...
       SPL transfer / swap / mint / game action / anything
```

`claim` creates a receipt PDA whose address *is* the intent's identity:

```text
receipt PDA = find_program_address(
    seeds = [
        b"commit-once",        // 11-byte domain prefix
        authority,             // 32 bytes — the signer
        namespace_hash,        // 32 bytes — sha256("commitonce/namespace/v1" || namespace)
        idempotency_key_hash,  // 32 bytes — sha256("commitonce/key/v1" || idempotency_key)
    ],
    program_id = CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB,
)
```

"Has this intent already committed?" becomes *whether an account exists* — a check that lives
in chain state, is atomic with the action it guards, and cannot be bypassed by rebuilding the
transaction. The downstream program does not import, know about, or change for CommitOnce.

## The guarantee, stated exactly

> For one `(authority, namespace, idempotency key)` tuple, **no more than one guarded
> transaction may successfully commit during the receipt retention period.**

That is **at-most-once successful execution of a guarded logical intent within the configured
retention window.** It is not "exactly once", and this project never describes it that way.
CommitOnce stops a second execution; it does not make the first one happen. Combined with
ordinary retry-until-success it gives exactly-once-style application semantics. Three words in
the guarantee are load-bearing and are never dropped: *at most once*, *guarded*, *within the
retention period*.

Two properties fall out of putting the guard in the same atomic transaction as the business
instructions, and both are asserted by tests rather than described in prose:

- **A receipt cannot exist without its action having committed.** If a later instruction
  fails, the receipt creation rolls back too, so a failed attempt stays retryable instead of
  being permanently poisoned.
- **A blocked duplicate cannot partially execute.** When `claim` errors, the transaction fails
  and the business instructions after it never run.

## What is verified today

| | |
| --- | --- |
| Program ID (all clusters) | `CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB` |
| Devnet deployment | **live and executable**, deploy slot `502020368`, signature `65gkC1p7XVQhQixacnudm9ZTpCQRFmESdMjDwu5AFTiiV4Po5gqj4oToEsjNpf2pVKFbttMFH4DjoPhqDTrHFBnX` |
| Demo counter program (devnet) | `EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5`, slot `501814798` |
| Rust test suite | **46 passing, exit 0**, executing the real compiled SBF artifact through LiteSVM |
| SDK test suite | **71 passing**, golden vectors cross-checked by an independent implementation |
| Composability | **executed on devnet** with the System Program, with SPL Token + Associated Token in one transaction, and with an arbitrary Anchor program — three of the four examples. The Jupiter swap is structural and says so |
| Measured overhead | **+404 bytes, +4 accounts** (usually +3 in practice); `claim` consumed 14,669 CU on devnet |
| Receipt account | 202 bytes, 1,676,400 lamports rent (0.0016764 SOL), fully refundable on cleanup |
| Mainnet | **not deployed** |
| Audit | **not audited** |
| npm | **not published** |
| Third-party adoption, users, revenue | **none** |

The load-bearing tests are a matched pair. `without_guard_two_rebuilt_transactions_execute_twice`
sends two genuinely rebuilt transactions and asserts the counter reaches **2** — the bug, on
chain, without the guard. `with_guard_rebuilt_retry_is_blocked_and_business_action_runs_once`
sends the same pair with the guard and asserts the second fails `AlreadyCommitted` and the
counter reaches **1**.

Composability is not asserted from reading the code. Three of the four integration examples have
been **executed against devnet** against the deployed program, each a single atomic transaction:

| Example | Composed with | Result |
| --- | --- | --- |
| `sol-transfer` | System Program `Transfer` | retry blocked; recipient gained exactly one transfer |
| `spl-transfer` | SPL Token `TransferChecked` + Associated Token `CreateIdempotent` | retry blocked; source fell by exactly one transfer, and no ATA rent was paid on the retry |
| `custom-program` | an arbitrary Anchor program | retry blocked; counter stayed at 1 — even though the first attempt carried two business instructions and the retry carried one |

Raw output for all three is in [`evidence/`](evidence/). The Jupiter-swap example is structural:
it needs Jupiter's live API and has never submitted a transaction. "Third-party adoption: none"
above means no external project depends on CommitOnce yet — it does **not** mean the guard is
untested against other programs.

## Blockchains and tools integrated

Solana only, deliberately. **Anchor 1.2.0** (program framework, IDL), **Solana toolchain
4.2.2** with `cargo-build-sbf`, **LiteSVM 0.10.0** (tests execute the real `.so`), **SBPFv2**
target, **TypeScript 7.0.2** and **`@solana/kit` 8.3.0** for the SDK, which has **zero runtime
dependencies** and uses WebCrypto for hashing. Apache-2.0. Full dependency and provenance
inventory in [`TECHNICAL_OVERVIEW.md`](TECHNICAL_OVERVIEW.md) §13.

## Honest positioning on novelty

The receipt-PDA-abort-if-exists mechanism is **not new**, and the "prepend a guard instruction"
developer experience is **not new**. Both are deployed prior art on Solana; Light Protocol's
`nullifier-program` is the closest and is live on mainnet. What this project adds is a
security model and a product: **authority-scoped receipt derivation enforced by the program
itself** (so a key cannot be griefed by a third party who learns it), a self-contained
instruction that needs **no RPC, prover or indexer**, first-class **namespaces**, and an
explicit **retention window with a refundable deposit and permissionless cleanup**. The
survey, with primary sources and the differences enumerated, is in
[`docs/PRIOR_ART.md`](../docs/PRIOR_ART.md).

## Who it is for

Anyone who retries a Solana transaction: payments processors, trading bots, game and mint
backends, relayers, subscription and payroll flows, and agent frameworks that pay
autonomously. The integration cost is one prepended instruction and no change to the
downstream program. See [`GTM.md`](GTM.md) for the concrete first-ten-users plan and
[`TRACTION.md`](TRACTION.md) for the honest traction position and the validation plan.

## What is not claimed

No mainnet deployment. No security audit. No npm publication. No third-party integration, no
users, no revenue, no waitlist, and no user feedback. This project has one founder, a
university engineering student, and no team. Those are absences, and they are stated here
rather than implied away — see [`EVIDENCE.md`](../EVIDENCE.md) §7 for the full list of what is
**not** verified.
