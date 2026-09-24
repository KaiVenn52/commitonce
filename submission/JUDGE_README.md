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

It runs the prerequisite checks, builds both programs (SBPFv3), verifies every `declare_id!`
against its `deploy-keys/*-keypair.json`, runs the Rust suite against the compiled SBF artifact in
LiteSVM, runs the benchmarks with output visible, runs the SDK typecheck/build/tests, and prints a
**PASS/FAIL summary with the true exit code**. A step that cannot run is reported as `NOT RUN`,
never as a pass, and `NOT RUN` also exits non-zero.

**It needs no configuration.** The toolchains are looked for on `PATH`; a layout specific to the
maintainer's machine (`/home/dell2u`) is used only when it is actually present, so a fresh clone
on macOS, Linux or a CI runner takes the ordinary path. A missing prerequisite is reported by name
with where to get it, rather than surfacing as a confusing cargo error. It does **not** deploy
anything, does **not** contact a cluster, and does **not** audit the code.

Individual steps, if you prefer:

```bash
bash scripts/build.sh                                  # build + verify program IDs
bash scripts/test.sh                                   # 60 Rust tests, expect exit 0
bash scripts/test.sh --test benchmarks -- --nocapture   # the overhead table
pnpm --filter @commitonce/solana test                   # 79 SDK tests
```

**Confirm the devnet deployment is real** (no build required):

```bash
solana program show CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB --url devnet
solana program show EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5 --url devnet
```

Expect `Last Deployed In Slot` **503174994** and **503175063**. The guard's deploy signature is
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
| Devnet deployment | **live and executable**, deploy slot `503174994` |
| Rust tests | **60 passing, exit 0**, executing the real compiled SBF artifact in LiteSVM |
| Rent-exemption rule, checked against a real runtime | **Verified** on `solana-test-validator` 4.2.2: a one-lamport pre-fund of a receipt PDA is refused by the cluster with `InsufficientFundsForRent`, so that griefing vector cannot be set up. |
| Composability, executed | System Program, SPL Token + Associated Token, **Token-2022**, an arbitrary Anchor program, a CPI from another program, and a **PDA authority via `invoke_signed`** |
| SDK tests | **79 passing**, golden vectors cross-checked by an independent implementation |
| Measured overhead | +404 bytes, +4 accounts (usually +3); `claim` ~14,000 CU on devnet |
| Receipt | 202 bytes, 1,676,400 lamports rent, fully refundable on cleanup |
| Build | SBPFv3, `readelf -h` reports `Flags: 0x3` |

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
| Transaction v1 messages | **Not tested, and cannot be with a stable client** — the newest stable `@solana/kit` (8.3.0, which this repository pins) has no v1 support; it is canary-only. |
| Address lookup tables / v0 end-to-end | **Tested** in `tests/versioned.rs`: the guard commits with all non-signer accounts loaded from a table, a rebuilt v0 retry is blocked, and a signer is never loaded from a table. |
| Non-Anchor clients | **Verified.** The SDK has zero runtime dependencies and imports nothing from Anchor's JS library; it hand-encodes everything and runs against the deployed program. |
| CPI from a **non-Anchor** program | **Tested** in `tests/native_cpi.rs` — five tests against a program with no Anchor dependency, which builds the instruction by hand. |
| CPI into `claim` from another program | **Tested** in `tests/cpi.rs` — seven tests, including a **PDA authority signed through `invoke_signed`**, which is what a Squads vault needs. |
| Genuine durable-nonce transactions | **Tested against devnet** in `apps/demo/nonce-policy.ts` — real nonce account, real nonce transaction, policy confirmed both ways. The harness cannot express one, which is why the Rust test injects the marker instead. |
| Compute units | **Measured on two real runtimes: `claim` costs 9,292 CU.** devnet (4.3.0-rc.0) and a local `solana-test-validator` (4.2.2) report the identical figure, and the harness median is 9,283 CU — within 0.1%. The 14,669 CU figure this row used to quote was taken on a build from before the pre-funded-PDA fix and the CPI instruction, and was never re-measured. Raw output: [`submission/evidence/devnet-cu-measurement.log`](evidence/devnet-cu-measurement.log), [`submission/evidence/validator-cu-measurement.log`](evidence/validator-cu-measurement.log). |
| SBPFv3 build | **Ships SBPFv3** (`e_flags = 0x3`). A real Agave validator rejects a v2 artifact and accepts v3; LiteSVM 0.16 accepts both. Redeployed as v3 on devnet. |
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

## Everything in this directory

`submission/JUDGE_README.md` is the entry point, and this is the index. Nine of these files
were previously unreachable from it, which for a reviewer is the same as not existing.

| File | What it is |
| --- | --- |
| [PROJECT_DESCRIPTION](PROJECT_DESCRIPTION.md) | the submission-form answers, in full |
| [SUBMISSION_FORM](SUBMISSION_FORM.md) | the ten portal fields, copy-paste ready |
| [TECHNICAL_OVERVIEW](TECHNICAL_OVERVIEW.md) | the whole system in one document |
| [FAQ](FAQ.md) | the hard questions, answered directly |
| [TRACTION](TRACTION.md) | honest zeros, and why they are zeros |
| [GTM](GTM.md) | demand, distribution, and what would have to be true |
| [FOUNDER_STORY](FOUNDER_STORY.md) | who built this and why |
| [WORK_LOG](WORK_LOG.md) | what was built during the Contest Period, including the bugs |
| [DEMO_SCRIPT](DEMO_SCRIPT.md) | the product-demo script |
| [PITCH_SCRIPT](PITCH_SCRIPT.md) | the presentation script |
| [VIDEO_SHOTLIST](VIDEO_SHOTLIST.md) | shot lists for both videos |
| [COLOSSEUM_GUIDES_BRIEF](COLOSSEUM_GUIDES_BRIEF.md) | the official sources, retrieved and quoted |
| [evidence/](evidence/) | raw output from every live run referenced in `EVIDENCE.md` |

## Repository access

**The source is public: <https://github.com/KaiVenn52/commitonce>** — Apache-2.0, default branch
`main`, readable without an account. Nothing needs to be granted for a judge to read it.

If it is ever made private, read access is granted to **`hackathon@colosseum.com`**. Two
videos — a 2:00–2:59 presentation and a ≤3:00 product demo — are linked from the submission
form; the scripts and shot lists for both are in this directory.
