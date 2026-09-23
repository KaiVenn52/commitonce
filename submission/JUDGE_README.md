# CommitOnce — start here

**Idempotency keys for Solana. Retry without executing twice.**

This is the fast entry point for a judge. Everything below is checkable; nothing below asks you to
take a claim on trust.

---

## The 30-second explanation

Solana's runtime deduplicates transactions by **message hash**, so it protects *signed bytes* — not
a *logical intent*. When a client's send times out and it retries, it rebuilds: fresh blockhash, a
higher priority fee, a re-signed transaction. New bytes, new message hash, and the runtime sees a
brand new transaction. **Both can land.** Solana's own production-readiness guide names this and
hands the remedy to the application: *"A rebuilt transaction has a new signature, so preserve
application-level idempotency before sending it."*

CommitOnce is that layer. One instruction, `commit_once::claim`, is prepended to the **same atomic
transaction** as your business instructions. It creates a receipt PDA keyed by
`(authority, namespace, idempotency key)`. If the receipt already exists, the instruction errors
and the whole transaction reverts — so the business instructions never run a second time, and your
program does not change.

> **The guarantee, stated exactly:** at-most-once successful execution of a guarded logical intent
> within the configured retention window. Not "exactly once" — it stops a second execution; it
> does not make the first one happen.

---

## Verify it yourself, in one command

```bash
bash verify.sh
```

It runs the prerequisite checks, builds both programs (SBPFv2), verifies every `declare_id!`
against its `deploy-keys/*-keypair.json`, runs the Rust suite against the compiled SBF artifact in
LiteSVM, runs the benchmarks with output visible, runs the SDK typecheck/build/tests, and prints a
**PASS/FAIL summary with the true exit code**. A step that cannot run is reported as `NOT RUN`,
never as a pass, and `NOT RUN` also exits non-zero.

It requires the project's WSL2 Ubuntu toolchain home (`/home/dell2u`); if that directory is absent
the script continues with your own `HOME` and fails with a specific message rather than a confusing
cargo error. It does **not** deploy anything, does **not** contact a cluster, and does **not**
audit the code.

Individual steps, if you prefer:

```bash
bash scripts/build.sh                                  # build + verify program IDs
bash scripts/test.sh                                   # 50 Rust tests, expect exit 0
bash scripts/test.sh --test benchmarks -- --nocapture   # the overhead table
pnpm --filter @commitonce/solana test                   # 71 SDK tests
```

**Confirm the devnet deployment is real** (no build required):

```bash
solana program show CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB --url devnet
solana program show EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5 --url devnet
```

Expect `Last Deployed In Slot` **503101216** and **503100411**. The guard's deploy signature is
`274PANsUJf4N9jtP8arkuSmzP15TctKk4vgHHJupYHt14JsgwieEYhm1pYmtYVxcwfFUbdUcdFzvNH1cfRTWpui9`,
visible on any devnet explorer.

**See the A/B for yourself** (devnet, needs a funded throwaway key):

```bash
export PAYER_KEYPAIR=~/.config/solana/id.json
node apps/demo/commitonce-demo.ts
```

Scenario A sends two genuinely rebuilt transactions with no guard and the counter reaches **2**;
scenario B sends the same pair with the guard and the counter reaches **1**.

---

## The two tests that carry the whole product

In `programs/commit-once/tests/invariant.rs`, both asserting on observable onchain state rather
than on error strings:

| Test | What it asserts |
| --- | --- |
| `without_guard_two_rebuilt_transactions_execute_twice` | the bug: two rebuilt transactions both land, counter = **2** |
| `with_guard_rebuilt_retry_is_blocked_and_business_action_runs_once` | the fix: the retry fails `AlreadyCommitted`, counter = **1** |

---

## Where the evidence is

| Document | What it answers |
| --- | --- |
| [`EVIDENCE.md`](../EVIDENCE.md) | **The authority.** Every verified claim, how to reproduce it, and §7: what is *not* verified |
| [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) | mechanism, layouts, design decisions, boundaries |
| [`docs/SECURITY_MODEL.md`](../docs/SECURITY_MODEL.md) | threat model, the tests guarding each threat, non-goals |
| [`docs/PRIOR_ART.md`](../docs/PRIOR_ART.md) | the landscape with primary sources — **§0 says the mechanism is not novel** |
| [`docs/CONCEPTS.md`](../docs/CONCEPTS.md) | the mental model: intent vs transaction |
| [`docs/API_REFERENCE.md`](../docs/API_REFERENCE.md) | every instruction, account, error code and export |
| [`docs/INTEGRATION_PLAYBOOK.md`](../docs/INTEGRATION_PLAYBOOK.md) | adding the guard to an existing app |
| [`docs/FAQ.md`](../docs/FAQ.md) | 34 developer-facing questions |
| [`RELEASE_RUNBOOK.md`](../RELEASE_RUNBOOK.md) | build, verify, deploy, roll back, and the traps |
| [`submission/WORK_LOG.md`](WORK_LOG.md) | dated record of what was built during the Contest Period |

## Reading order if you have ten minutes

1. **This page** (2 min).
2. `programs/commit-once/tests/invariant.rs` — the A/B pair (3 min).
3. [`EVIDENCE.md`](../EVIDENCE.md) §7 — the honest list of what is unverified (2 min).
4. [`docs/PRIOR_ART.md`](../docs/PRIOR_ART.md) §0 and §4 — what is and is not new (3 min).

If you have thirty minutes, add `docs/SECURITY_MODEL.md` §3 (the threat model) and
`submission/FAQ.md` (why this is a company, what the biggest risk is, and what has not been
verified).

---

## What is verified today

| | |
| --- | --- |
| Program ID (identical on all clusters) | `CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB` |
| Devnet deployment | **live and executable**, deploy slot `503101216` |
| Rust tests | **50 passing, exit 0**, executing the real compiled SBF artifact in LiteSVM |
| SDK tests | **71 passing**, golden vectors cross-checked by an independent implementation |
| Measured overhead | +404 bytes, +4 accounts (usually +3); `claim` ~14,000 CU on devnet |
| Receipt | 202 bytes, 1,676,400 lamports rent, fully refundable on cleanup |
| Build | SBPFv2, `readelf -h` reports `Flags: 0x2` |

---

## What is not done — read this before forming a view

Stated plainly, because a submission that only lists successes is not evidence.

| Not done | Detail |
| --- | --- |
| **Mainnet deployment** | Not deployed. No mainnet keypair or funding exists. |
| **Security audit** | **Not audited.** Nothing should be put in front of real value before one. |
| **npm publication** | `@commitonce/solana` is not published. Adopting today means building from source. |
| **Users** | Zero. |
| **Integrations** | Zero. No external project uses CommitOnce. |
| **Revenue** | Zero. Nothing is for sale; the core is Apache-2.0. |
| **Traction of any kind** | None. See [`TRACTION.md`](TRACTION.md), which opens with a table of zeros. |
| **Team** | One founder, a university engineering student, no team. |
| Transaction v1 messages | Not tested (v1 does not change message-hash deduplication, but that is an expectation, not a measurement). |
| Address lookup tables / v0 end-to-end | **Tested** in `tests/versioned.rs`: the guard commits with all non-signer accounts loaded from a table, a rebuilt v0 retry is blocked, and a signer is never loaded from a table. |
| Non-Anchor clients | **Verified.** The SDK has zero runtime dependencies and imports nothing from Anchor's JS library; it hand-encodes everything and runs against the deployed program. |
| CPI into `claim` from another program | **Tested** in `tests/cpi.rs`: `demo-counter` calls `claim` itself, the invariant holds through the CPI, and the guard program account cannot be substituted. |
| Genuine durable-nonce transactions | **Tested against devnet** in `apps/demo/nonce-policy.ts` — real nonce account, real nonce transaction, policy confirmed both ways. The harness cannot express one, which is why the Rust test injects the marker instead. |
| Compute units on mainnet | Not measured. And the in-process harness does **not** match the runtime: devnet reported `claim` at 14,669 CU while the harness reports 9,283 (median). Budget from the devnet figure. |
| SBPFv3 build | Not verified, and deliberately not shipped, because LiteSVM cannot verify it. |
| Concurrent claims of one key | Tested in two places. In-process: five transactions, one blockhash (one slot) — one commits, four fail `AlreadyCommitted`. Live on devnet: 5–8 competing transactions at real validators — same result. Caveat: the live runs spread over 2–3 slots, because a client cannot force a leader to pack them together. |

---

## What this project does not claim

- **Not novel in mechanism.** The receipt-PDA-abort-if-exists mechanism and the "prepend a guard
  instruction" developer experience are both deployed prior art on Solana; Light Protocol's
  `nullifier-program` is the closest and is live on mainnet. What is new is the security model and
  the productization — see [`docs/PRIOR_ART.md`](../docs/PRIOR_ART.md) §0.
- **Not "exactly once."** The guarantee is at-most-once, bounded by the retention window, and the
  repository says so in the program's own doc comment, the README, the concepts document and the
  security model.
- **Not audited, not production-ready, not on mainnet.**

## Repository access

**The source is public: <https://github.com/KaiVenn52/commitonce>** — Apache-2.0, default branch
`main`, readable without an account. Nothing needs to be granted for a judge to read it.

If it is ever made private, read access is granted to **`hackathon@colosseum.com`**. Two
videos — a 2:00–2:59 presentation and a ≤3:00 product demo — are linked from the submission
form; the scripts and shot lists for both are in this directory.
