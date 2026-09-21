# CommitOnce — work log (Contest Period)

**Contest Period:** 6:00am PT 2026-09-14 → 11:59pm PT 2026-10-12 (`2026-10-13T06:59:00Z`).
Source: Official Rules §5–§6(b), corroborated by the hackathon page's `countdownTarget`.

This log exists because the rules make the development timeline load-bearing:

> "Teams may begin development before the hackathon, but **products are judged only on the work
> completed between the competition's start and end dates**."
>
> "Builders may use pre-existing code, but teams **must disclose all relevant past development work
> in the submission form**."
>
> — hackathon FAQ, quoted in [`docs/COLOSSEUM_REQUIREMENTS.md`](../docs/COLOSSEUM_REQUIREMENTS.md) §2

---

## 1. Disclosure: pre-existing work

**There is no pre-existing CommitOnce code to disclose.** Every first-party file in this
repository — both programs, the SDK, the tests, the examples, the demo, the scripts and all
documentation — was written inside the Contest Period. This is stated as a fact rather than a
reassurance, and §4 shows the timestamps it rests on.

**Third-party open-source code is not "pre-existing code" under the FAQ** (*"'Pre-existing code'
does not refer to open-source code developed by others. We encourage founders to compose with
existing crypto protocols."*), but Rules §9 still requires disclosure of its status and ownership.
That inventory is in [`TECHNICAL_OVERVIEW.md`](TECHNICAL_OVERVIEW.md) §13, with exact versions in
`Cargo.lock` and `pnpm-lock.yaml`. Summary:

| Dependency | Version | Role | First-party code derived from it |
| --- | --- | --- | --- |
| `anchor-lang` | 1.2.0 | program framework, IDL, account constraints | none |
| `solana-instructions-sysvar` | 3.0.0 | reading the Instructions sysvar for durable-nonce detection | none |
| `litesvm` | 0.10.0 | test harness — executes the real compiled SBF artifact | none |
| `@solana/kit` | 8.3.0 (peer `^8.0.0`) | the caller's transaction stack | none |
| `sha2`, `solana-*` (tests), `@solana-program/*`, `typescript`, `vitest` | see lockfiles | hashing, test plumbing, build tooling | none |

**No code was vendored, copied or adapted from any Solana project.** One *technique* is attributed
to another project and is recorded here rather than left implicit: rejecting durable-nonce
transactions by inspecting the Instructions sysvar for `AdvanceNonceAccount` is borrowed from
Squads' `nonce-guard`, which inspects the same sysvar for the same reason. The implementation in
`programs/commit-once/src/instructions/claim.rs` is independent and shares no code.

**Prior art by others is cited, not obscured.** [`docs/PRIOR_ART.md`](../docs/PRIOR_ART.md) §0
leads with the finding that the receipt-PDA mechanism and the prepend-a-guard developer experience
are already deployed on Solana mainnet. Claiming either as an invention would be a
misrepresentation, and the submission does not.

---

## 2. How this log was derived, and its limits

Three sources, in order of reliability:

1. **The repository's own artifacts and recorded results** — [`EVIDENCE.md`](../EVIDENCE.md)
   (recorded 2026-09-20 UTC, since updated), build artifacts in `target/`, the IDL, and the test
   suites themselves.
2. **File modification timestamps** in the working tree, read at the time of writing.
3. **The repository's research documents**, which carry their own retrieval dates
   (`docs/PRIOR_ART.md`: retrieved 2026-09-19; `submission/COLOSSEUM_GUIDES_BRIEF.md`: retrieved
   September 2026).

**Limits, stated so the log is not over-trusted:**

- **The repository has no commit history.** `git log` reports *"your current branch 'master' does
  not have any commits yet"*, so there is no per-commit record of when work landed. The dated
  entries below therefore rest on file modification timestamps, which are supporting evidence
  rather than proof — a file's mtime can be changed by copying it. **Committing the work is a
  pending action** (see §6), and it is the single easiest way to make this log verifiable.
- Timestamps are local to the development machine and are not UTC-labelled. Day boundaries below
  are as recorded on that machine.
- No hours-worked figures are claimed. This log records what was produced, not how long it took.

**Boundary check.** Every first-party file's timestamp falls on **2026-09-19, 2026-09-20 or
2026-09-21** — all inside the Contest Period, which opened 2026-09-14. Nothing in the tree predates
the Contest Period.

---

## 3. Timeline

### 2026-09-19 — repository, keypairs, program skeleton, research

| Time | Artifact | What it is |
| --- | --- | --- |
| 14:36 | `.gitignore`, `.gitattributes` | repository scaffolding |
| 14:38 | `deploy-keys/commit_once-keypair.json`, `deploy-keys/demo_counter-keypair.json` | the two program keypairs; the program IDs are derived from them and are identical on every cluster |
| 14:39–14:40 | `programs/commit-once/src/{error.rs,state.rs,instructions.rs,events.rs}`, `instructions/close_receipt.rs` | program skeleton: error enum, receipt account, instruction modules, events |
| 14:40 | `rust-toolchain.toml`, `Cargo.toml`, `programs/demo-counter/Cargo.toml` | Rust workspace |
| 14:53 | `package.json`, `.npmrc`, `tsconfig.base.json`, `packages/sdk/tsconfig*.json`, `packages/sdk/scripts/build.mjs` | TypeScript workspace and SDK build |
| 14:56 | `docs/research/prior-art-landscape-raw.md`, `pnpm-workspace.yaml` | raw prior-art research trail |
| 14:58–15:00 | `submission/COLOSSEUM_GUIDES_BRIEF.md`, `docs/COLOSSEUM_REQUIREMENTS.md` | extraction of the official rules, guides and deadlines from primary sources |
| 15:10 | `programs/commit-once/src/instructions/claim.rs` | the `claim` instruction |
| 15:14 | `programs/commit-once/src/constants.rs` | seeds, version, retention bounds, slot rate, nonce discriminator |
| 15:18 | `packages/sdk/src/constants.ts` | SDK-side constants |

### 2026-09-20 — both programs, the SDK, the test suites, devnet deployment, first evidence record

`EVIDENCE.md` states it was recorded on this date (UTC). The devnet deployment it documents —
`commit_once` at deploy slot **501814672**, `demo_counter` at **501814798** — was verified on this
day.

| Time | Artifact | What it is |
| --- | --- | --- |
| 00:13 | `Anchor.toml`, `programs/commit-once/src/lib.rs`, `programs/demo-counter/src/lib.rs`, `programs/commit-once/Cargo.toml` | both programs wired up, `declare_id!` compiled in |
| 00:15 | `Cargo.lock` | dependency resolution pinned |
| 00:19–00:26 | `packages/sdk/src/{pda.ts,instructions.ts,accounts.ts,client.ts}` | PDA derivation, wire-format encoding, receipt decoding, RPC client |
| 00:20–00:25 | `scripts/test.sh`, `scripts/build.sh` | build and test entry points (SBPFv2 pinning, program-ID verification) |
| 00:36–00:48 | `programs/commit-once/tests/{invariant.rs,retention.rs}`, `tests/common/mod.rs` | the core A/B tests, retention tests, and the LiteSVM harness |
| 00:39–00:53 | `packages/sdk/scripts/print-vectors.mjs`, `packages/sdk/test/vectors.test.ts`, `packages/sdk/src/{hash.ts,errors.ts,index.ts}` | golden vectors, including the independent recomputation path |
| 01:14 | `packages/sdk/tsconfig.cjs.json` | dual ESM/CJS output |
| 01:17–01:22 | `docs/ARCHITECTURE.md`, `docs/SECURITY_MODEL.md` | mechanism and threat model |

Recorded on this date in `EVIDENCE.md`: toolchain versions, both `.so` artifacts with sizes and
SHA-256, both devnet deployments with slots and signatures, the Rust suite result (**40 passing,
exit 0**, executing the real compiled SBF artifact), the SDK suite result (**48 passing**), and the
benchmark figures (+9,837 CU, +404 bytes, +4 accounts; `claim` 7,783 CU; duplicate-blocked
9,553 CU; `close_receipt` 2,701 CU; receipt 202 bytes / 1,676,400 lamports).

### 2026-09-21 — security tests, benchmarks, examples, docs, demo, verification script, submission

The largest day by artifact count.

| Time | Artifact | What it is |
| --- | --- | --- |
| 16:14 | `programs/commit-once/tests/security.rs` | griefing, receipt substitution, malformed state, durable-nonce policy |
| 16:22 | `programs/commit-once/tests/benchmarks.rs` | the measured overhead table |
| 16:24 | `docs/PRIOR_ART.md` | primary-source competitive survey, including the finding that the mechanism is not novel |
| 16:26–16:31 | `examples/{sol-transfer,spl-transfer,custom-program,jupiter-swap}/` | four guarded integration examples with package manifests |
| 16:30 | `docs/CONCEPTS.md` | the intent-vs-transaction mental model |
| 16:32 | `docs/API_REFERENCE.md` | every instruction, account, error code and SDK export |
| 16:33 | `LICENSE` | Apache-2.0 |
| 16:35–16:52 | `apps/demo/` — `commitonce-demo.ts` and `src/{demo-counter,errors,payer,report,solana}.ts` | the A/B demo CLI: two scenarios, fresh authorities, explorer links |
| 16:36 | `.env.example`, `docs/QUICKSTART.md` | environment template and getting-started guide |
| 16:37 | `.github/workflows/ci.yml` | CI workflow |
| 16:38 | `verify.sh`, example `README.md` files | one-command end-to-end verification with a PASS/FAIL summary |
| 16:39 | `docs/INTEGRATION_PLAYBOOK.md` | adding the guard to an existing application |
| 16:43 | `programs/commit-once/tests/wire_format.rs` | wire-format and layout pinning, including the cross-language PDA vector test that took the suite from 39 to **40** tests |
| 16:45 | `CONTRIBUTING.md`, `NEEDS_OWNER_ACTION.md`, `RELEASE_RUNBOOK.md`, `SECURITY.md`, `EVIDENCE.md`, `README.md` | contribution guide, owner-action list, release runbook, security policy, evidence record, README |
| 16:47–16:52 | `submission/` — project description, technical overview, pitch script, demo script, shot list, go-to-market, traction, founder story, FAQ, judge README, this work log | the submission package |

---

## 4. What the Contest Period produced, by component

| Component | Location | State |
| --- | --- | --- |
| Guard program (`claim`, `close_receipt`) | `programs/commit-once/` | built (SBPFv2), deployed to devnet, 40 tests passing |
| Demo counter program | `programs/demo-counter/` | built, deployed to devnet |
| TypeScript SDK `@commitonce/solana` v0.1.0 | `packages/sdk/` | built (ESM + CJS + types), 48 tests passing, **not published to npm** |
| Rust test suite | `programs/commit-once/tests/` | 40 tests, exit 0, executing the real compiled artifact in LiteSVM |
| SDK test suite | `packages/sdk/test/` | 48 tests, with golden vectors cross-checked by an independent implementation |
| A/B demo CLI | `apps/demo/` | written; a devnet run is not yet recorded in `EVIDENCE.md` |
| Integration examples | `examples/` | four examples written; none executed against a live cluster |
| Verification | `verify.sh`, `scripts/` | one command, PASS/FAIL summary, non-zero exit on any step that did not run |
| Documentation | `docs/`, `README.md`, `SECURITY.md`, `RELEASE_RUNBOOK.md` | architecture, security model, concepts, API reference, quickstart, integration playbook, developer FAQ, prior art, release runbook |
| Submission package | `submission/` | this set of documents |

## 5. Verified results, with their dates

Recorded in [`EVIDENCE.md`](../EVIDENCE.md) (recorded 2026-09-20 UTC) and reproducible from the
working tree:

| Result | Value | Date recorded |
| --- | --- | --- |
| `commit_once` devnet deployment | slot `501814672`, signature `5N8nwtyQSnA9XvRGLJMqsZrGmz3zFG1zPgWzcNmqyRo9N6udGT6RhsCV6mo8G68mWEWcsDziM44M6cuuHW6Hb4uW` | 2026-09-20 |
| `demo_counter` devnet deployment | slot `501814798` | 2026-09-20 |
| Rust suite | 40 passing, exit 0 | 2026-09-20 |
| SDK suite | 48 passing | 2026-09-20 |
| `commit_once.so` | 153,472 bytes, SHA-256 `56bc2084e4f1d0b3345938e3e9406eb0af0686b410f1cb8c78cf4fe9129f25b5` | 2026-09-20 |
| `demo_counter.so` | 138,064 bytes, SHA-256 `13b2b469276cafe298a511b01c67bc4e7601b37316c1b24b3364fb31f84e04f4` | 2026-09-20 |
| Overhead | +9,837 CU, +404 bytes, +4 accounts | 2026-09-20 |

## 6. What was not done during the Contest Period

Listed because the rules penalise omission as much as invention, and because the honest version of
this log is more useful than the flattering one.

| Not done | Detail |
| --- | --- |
| **No git commit history** | The working tree has never been committed. This is the most actionable gap: committing makes the dates in §3 independently verifiable, and it is a normal expectation of a submission. |
| **No mainnet deployment** | Not deployed, no mainnet keypair or funding. |
| **No security audit** | The program is unaudited. |
| **No npm publication** | The SDK exists and builds; it is not published. |
| **No users, integrations, revenue** | None. See [`TRACTION.md`](TRACTION.md). |
| **No recorded devnet demo run** | The A/B is proven by the test suite; the standalone demo runner's devnet execution is not yet recorded in `EVIDENCE.md`. |
| **No examples executed against a live cluster** | The four examples are written and their READMEs say so. |
| **Transaction v1 / address lookup tables** | Not tested. |
| **Non-Anchor callers** | Not tested. |
| **Compute units on mainnet** | Not measured. |

The remaining work that is blocked on a credential, a payment or an account — Colosseum
registration, video recording, npm publish token, mainnet decision, domain, audit budget, legal —
is enumerated with the exact command or action required in
[`NEEDS_OWNER_ACTION.md`](../NEEDS_OWNER_ACTION.md). Nothing in this log is blocked on anything
else.

---

## 7. Authorship

One person wrote all of it: a solo founder, a university engineering student, with no team, no
cofounders and no contributors. No part of this repository was generated by another party on the
founder's behalf, and no third-party code was incorporated. The founder story, including the limits
of the founder's experience, is in [`FOUNDER_STORY.md`](FOUNDER_STORY.md).
