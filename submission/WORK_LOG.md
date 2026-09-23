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
2. **Git commit history**, which now exists: the repository was committed on 2026-09-21.
3. **File modification timestamps** in the working tree, read at the time of writing.
4. **The repository's research documents**, which carry their own retrieval dates
   (`docs/PRIOR_ART.md`: retrieved 2026-09-19; `submission/COLOSSEUM_GUIDES_BRIEF.md`: retrieved
   September 2026).

**Limits, stated so the log is not over-trusted:**

- **The commit history is shallow and was created late.** The work was authored as a working tree
  and committed on 2026-09-21, so the history has a small number of commits and does not record
  the intermediate steps. It establishes that the code existed by that date; it does not
  reconstruct a day-by-day timeline. The dated entries below therefore rest mainly on file
  modification timestamps, which are supporting evidence rather than proof — a file's mtime can be
  changed by copying it.
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
SHA-256, both devnet deployments with slots and signatures, the Rust suite result (**41 passing,
exit 0**, executing the real compiled SBF artifact), the SDK suite result (**71 passing**), and the
benchmark figures (+404 bytes, +4 accounts; compute units reported as a range, because LiteSVM's
compute accounting turned out not to be reproducible run to run — see the 2026-09-21 entry below
for how that was found and corrected).

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
| 16:43 | `programs/commit-once/tests/wire_format.rs` | wire-format and layout pinning, including the cross-language PDA vector test that took the suite from 39 to **40**, then to **41** tests |
| 16:45 | `CONTRIBUTING.md`, `NEEDS_OWNER_ACTION.md`, `RELEASE_RUNBOOK.md`, `SECURITY.md`, `EVIDENCE.md`, `README.md` | contribution guide, owner-action list, release runbook, security policy, evidence record, README |
| 16:47–16:52 | `submission/` — project description, technical overview, pitch script, demo script, shot list, go-to-market, traction, founder story, FAQ, judge README, this work log | the submission package |
| 17:00–17:45 | `examples/package.json`, `examples/tsconfig.json`, `pnpm-workspace.yaml` | the four examples added to the pnpm workspace and typechecked; **all four had real type errors** that had never been caught, because nothing compiled them |
| 17:05–17:30 | `verify.sh` | SDK steps routed to the toolchain that owns `node_modules`; a `consumers typecheck` step added. **10 steps at this point** (11 after the brand check was added at 23:35), all passing |
| 17:35 | `packages/sdk/README.md` | SDK-level README |
| 17:40–17:50 | `apps/demo/commitonce-demo.ts` executed against devnet | four signatures recorded, A reached 2 and B reached 1 |
| 17:50 | `submission/evidence/devnet-demo-run.log` | the raw demo output, kept as evidence |
| 17:55 | first commits (`git log`) | the working tree committed, so the dates in this log are independently checkable |
| 18:30 | `programs/commit-once/tests/benchmarks.rs` rewritten | **the single-compute-unit figures in the earlier entries were wrong.** Three consecutive runs of the same unmodified test binary against the same byte-identical `.so` reported a bare counter increment at 5,567, 7,067 and 19,067 CU, and the guard delta between 8,337 and 9,837. The benchmark now measures each figure across 9 independent environments and reports min/median/max, asserts only the exact structural numbers, and the README, `EVIDENCE.md`, the SDK README, the submission package and the website were all corrected to quote ranges |
| 18:35 | devnet compute units read out of the recorded demo log | the cluster's own figures (`claim` 14,669 CU on success, 13,977 CU blocked, increment 4,067 / 7,067) are now quoted alongside the harness's, because they differ and the cluster is the authoritative runtime |
| 19:05 | `submission/evidence/devnet-demo-run.log` re-encoded | the log had been written by a Windows PowerShell redirect, which produces **UTF-16LE with a BOM**: unreadable on Linux and macOS, and treated as **binary** by git, so the evidence could not be diffed or reviewed at all. Converted to UTF-8 and `*.log text eol=lf` added to `.gitattributes` so it cannot recur |
| 19:20 | `programs/commit-once/tests/invariant.rs` | the recorded limitation "concurrent claims in the same slot are not tested" was **wrong** — `only_the_first_of_many_attempts_commits` already did exactly that. Strengthened it to assert the *reason* for each of the four losing attempts (a failure for an unrelated reason would previously have counted as a pass) and that all five were processed at one slot, and added `same_intent_with_different_downstream_instructions_is_still_blocked`. Rust suite 40 → **41** |
| 19:45 | `packages/sdk/src/events.ts`, `test/events.test.ts` | **event decoding**, the last real SDK gap: the SDK could build and inspect accounts but could not read the program's own events, so any integration wanting to react to a commit had to hand-roll the Borsh layout. Adds `decodeEventsFromLogs` and friends with a dependency-free base64 decoder, pinned against a real `IntentCommitted` emitted on devnet. SDK suite 48 → **71** |
| 19:50 | `packages/sdk/scripts/check-dual-format.mjs` | extended to cover the new exports, and now decodes the captured devnet event in **both** the ESM and CJS builds and compares the results — a module added to one entry point and not the other fails here |
| 20:10 | `apps/demo/concurrent-claim.ts` | the first test that puts **one idempotency key into several transactions against real validators**. The Rust suite proves the invariant in LiteSVM, in-process and single-threaded; that is not the same as a live cluster, and this was the last honest gap in the evidence. It mints a fresh authority, reads one blockhash so every attempt targets the same slot, gives each attempt a different priority fee so each is a genuinely distinct transaction, fires them all without awaiting any of them, and confirms them with one batched status poll |
| 20:25 | first live run **failed on infrastructure, not on the product** | HTTP 429 from the public devnet endpoint (`x-ratelimit-endpoint-remaining: -1821`). The cause was mine: `submitAndConfirm` per transaction means N concurrent `getSignatureStatuses` polling loops, and devnet rate-limits per method. Fixed by adding `submitManyAndConfirm` to `apps/demo/src/solana.ts` — one batched status call for every signature, and a 429 on send retried with the server's own `retry-after` honoured, because losing one attempt to a rate limit would silently turn a five-way race into a four-way one and overstate the result |
| 20:40 | `submission/evidence/devnet-contention-run.log` | **the invariant holds on a live cluster**: of 5 transactions carrying one key, exactly 1 committed and 4 were rejected onchain with `AlreadyCommitted` (6000); the counter advanced by exactly one; the decoded event's `created_slot` matches the winner's slot |
| 20:45 | the same runs, read honestly | **all three runs (5, 8, 5 attempts) spread across 2–3 slots, not one.** The winner lands alone in an earlier slot and the losers pack into the next. A slot's leader decides what to pack and a client cannot force two transactions into one slot, so the live test demonstrates contention on a real cluster but *not* the same-slot case. The evidence log and `EVIDENCE.md` say exactly that rather than implying the live run proves same-slot behaviour |
| 20:50 | the contention script now sweeps its unspent balance back to the payer | the first version funded a throwaway authority with 0.05 SOL and destroyed whatever was left, which is wasteful for a test meant to be re-run. Funding dropped to 0.01 SOL and the remainder is returned (0.0071 SOL recovered). The receipt's 0.0016764 SOL stays locked by design |
| 23:00 | `docs/COLOSSEUM_REQUIREMENTS.md` §10 — the official pages re-fetched | Colosseum relaunched the site since the first read, so every operative page was fetched again. **Nothing binding changed**: the dates, the $840,000 prize split, the Solana track at $100,000, the judging criteria, the repo expectations and the required submission fields are all word-for-word as recorded. Three things were added — see the next two rows — and the developer-resources URL moved from `/worldsfair/resources` to `/arena/resources` |
| 23:05 | the judging panel is now public, and it is technical | the live page names the track judges. The one that matters most for a Solana runtime primitive is **Jed Halfon, Chief Strategy Officer of Anza** — Anza builds the Agave validator, so he knows the message-hash deduplication behaviour first-hand. That cuts both ways: the insight will be understood immediately, and any overstatement about it will be caught immediately. It is the strongest argument for the posture the project already takes: `docs/PRIOR_ART.md` §0 leads with the mechanism not being novel, and the guarantee is stated as at-most-once within a retention window rather than "exactly once" |
| 23:10 | weekly updates — a requirement the project had not been meeting | the FAQ asks for a *"concise, one-minute video"* each week and *"strongly recommend[s]"* them *"for anyone serious about competing"*. Not required, not a scored criterion, but it is the only channel that puts work in front of Colosseum **during** the Contest Period rather than at the end. Added to `NEEDS_OWNER_ACTION.md` as an owner action, because it needs a recorded video |
| 23:20 | `assets/brand/` — the product logo, which did not exist | **"A product logo or graphic" is a required submission field and the repository had no logo at all**: the only image asset was a favicon, and `docs/COLOSSEUM_REQUIREMENTS.md` pointed at an `apps/web/public/` directory that does not exist. The mark is a committed receipt in front and a rejected duplicate behind it, with a `1` rather than a checkmark — a check says "this succeeded", which every product says; a `1` says *exactly one*, which is what this product guarantees. Three SVGs and ten PNGs, palette-bound to the site's CSS tokens |
| 23:30 | the mark verified by sampling and by printing the raster | this model cannot read images, so "looks right" was unavailable. The rendered pixels were sampled at each size and the raster printed as characters instead. That found a real defect: the duplicate's stroke is 16 units at 34% opacity, which is about one pixel at 32px and antialiases to `#100f0f` against the `#0b0c0e` background — five levels of 255, invisible. Fixed by adding a **compact mark** for below 48px rather than thickening the stroke and unbalancing the large sizes. At 16px the compact mark still does not resolve a legible `1`, and `assets/brand/README.md` says so instead of implying otherwise |
| 23:35 | `scripts/check-brand.mjs` | the mark exists in three SVGs and ten PNGs, and the failure mode is drift: someone edits `--accent` in the stylesheet and the logo stops matching the product. This reads the palette **out of `apps/web/styles.css`** and fails if any brand colour is outside it, asserts the compact mark has not grown the duplicate back, asserts every exported PNG exists and is really a PNG, and asserts the site points at `assets/brand/` rather than keeping a copy. Dependency-free — no rasterizer — so it runs anywhere Node does, and it is now step 7 of `verify.sh` |
| 23:40 | three stale claims found while wiring the logo in | `NEEDS_OWNER_ACTION.md` told the owner to run `node run.ts --scenario both` — the file is `commitonce-demo.ts` and **there is no `--scenario` flag**, so the instruction could not have worked; it also referenced an `apps/demo/README.md` that did not exist, now written. And `submission/DEMO_SCRIPT.md` still said the devnet A/B run was *"not recorded in EVIDENCE.md"* when it has been recorded since 2026-09-21 |
| 23:50 | the composability gap, which was the largest provable one left | every judging rubric scores **open-source / composability** explicitly, and Colosseum's own winner data says developer tooling *"punches above its weight"* — but all four integration examples were **structural**. They were typechecked and nothing more: not one had ever submitted a transaction, so the claim "the guard composes with other programs" rested on reading the code rather than on evidence. Three of them are now executed against devnet |
| 23:55 | `examples/sol-transfer` executed against devnet | composed with the System Program's lamport transfer. Phase 1 committed in one attempt; phase 2 rebuilt with a fresh blockhash and the same key and was blocked with `AlreadyCommitted` (6000). Recipient went 0 → 1,000,000 lamports — exactly one transfer, not two. Raw output in `submission/evidence/devnet-sol-transfer-run.log`. It needs only a funded keypair and any recipient address |
| 00:05 | `examples/spl-transfer` executed against devnet | the strongest of the three, because it puts **two** third-party programs in the same atomic transaction as the guard, one of them conditional on state that may not exist yet: `claim` → ATA `CreateIdempotent` → SPL `TransferChecked`. Source 1,000,000,000 → 999,000,000, destination 0 → 1,000,000 — one transfer. The log's own words: *"duplicate blocked, no ATA rent paid and no tokens moved"*. Wrote `examples/spl-transfer/setup-devnet.sh` so the devnet state it needs is reproducible by anyone rather than a one-off I happened to have |
| 00:15 | `examples/custom-program` executed against devnet | the case a naive approach gets wrong. Phase 1 carried **two** business instructions (`initialize` *and* `increment`, because the counter did not exist yet) and phase 2 carried **one**. The guard blocked the retry anyway: counter stayed at 1, *"duplicate blocked, the counter was not incremented again"*. So the invariant holds across two different transaction shapes for one logical intent, which is exactly what a message-hash comparison cannot do |
| 00:20 | three devnet runs, read honestly | each is a single run of a single example, not a soak test, and each proves composability **on devnet only**. `jupiter-swap` remains structural — it needs Jupiter's live API, and I did not fake it. Every README, `EVIDENCE.md` and the work-log limitation table now say three of four rather than four of four |
| 00:40 | auditing `claim`, and a real defect: **the durable-nonce scan failed open** | `claim` refuses a durable nonce with a finite retention, because a nonce transaction never expires and cleanup would later reopen the duplicate window. It detects one by scanning the transaction's instructions for `AdvanceNonceAccount`, bounded by `MAX_INSTRUCTION_SCAN = 128`. Running out of budget returned **"no nonce found"** — so padding a transaction with filler would have hidden a real nonce past the bound and let a caller combine a nonce with a finite retention, which is exactly what the check exists to prevent. Now it **fails closed** with a new `InstructionScanInconclusive` (6011) rather than guessing. This is the kind of defect that only shows up by reading the failure branch rather than the happy path |
| 00:50 | and then the more interesting half: **the fail-open branch was unreachable** | writing the test to prove the bypass exposed something better. The first attempt padded with a truncated `Transfer`, which the System Program rejected before `claim` ever ran — a reminder that filler has to actually execute. The second attempt padded with zero-lamport transfers and died with `InstructionError(64, MaxInstructionTraceLengthExceeded)`: **the SVM caps a transaction at its own instruction ceiling**. So `MAX_INSTRUCTION_SCAN = 128` can never be exhausted today. I am recording that as the finding rather than as a win — the fix is still correct, but it closed a hole that the runtime was already closing for us |
| 01:00 | the ceiling is now discovered, not assumed | the test that asserts "the bound is above the ceiling" first hardcoded 64 from memory, and the runtime reported the failure at index **63**. Rather than guess again, `discover_instruction_ceiling` probes upward until a transaction fails, then asserts `MAX_INSTRUCTION_SCAN` sits above whatever it found. A number owned by another codebase is exactly the kind of thing that changes without warning, so the test measures it and fails loudly if a future runtime raises its ceiling past 128. The same test confirms the largest allowed transaction is still scanned to completion, so the bound causes no spurious refusals. Rust suite 41 → **42** |
| 01:20 | `scripts/check-package.mjs` — the SDK had never been installed by anyone | every consumer in this repository reaches the SDK through a pnpm **symlink**, and a symlink hides exactly the faults that break a real install: a missing `files` entry, an `exports` map that does not resolve, a `types` path pointing at nothing, a dependency that was only present because the monorepo hoisted it. So the package was packed, installed into a throwaway project in the OS temp directory, and exercised there. The consumer reproduces the golden PDA vector, reads the pinned rent and account-size constants, and classifies a real error string — **under both ESM and CJS** — and then TypeScript resolves the shipped `.d.ts` with the monorepo absent. It also fails if the install resolves back into the workspace, because that would make every assertion vacuous, and if the tarball ships `src/`, `test/`, `scripts/` or `tsconfig.json`. Tarball is 51,191 bytes; contents are `LICENSE README.md dist package.json` |
| 01:25 | three failures while writing that check, all mine | `execFileSync('pnpm.cmd', …)` dies with `EINVAL` on Windows because a `.cmd` is not executable without a terminal — `execSync` via cmd.exe is the only way. My first consumer passed `namespace`/`idempotencyKey` to `deriveReceiptAddress`, which takes **hashes**; the SDK rejected it with a clear `RangeError` naming the right functions, which is the error message doing its job. And my TypeScript probe passed a bare string where kit wants a branded `Address`, so the compiler was right and I was wrong |
| 01:40 | `scripts/check-docs.mjs` — most of this project's claims live in prose, and prose rots | the ad-hoc sweep I had been running by hand checked markdown links and a hardcoded list of stale phrases. It did **not** check the website's `href` attributes at all, which is the artifact a judge is most likely to click through, and it printed test counts without asserting them. The repo version checks markdown *and* html links, that every evidence log is referenced by a document, that quoted test counts are counts the suites actually produce, and that no corrected claim has come back. It is now step 12 of `verify.sh` |
| 01:50 | the first run found 21 problems, and **all 21 were the checker's fault** | it matched its own pattern list, and it flagged *correct* negations — `apps/demo/README.md` says "there is **no** `--scenario` flag", and `jupiter-swap` correctly says it has not been executed. A naive substring match treats a corrected statement as a regression. Rewrote the needles as precise patterns with file scoping, exempted the checker itself and the work log (a dated record legitimately quotes the bugs it fixed). A check that cries wolf gets switched off, so the precision is not fussiness |
| 01:55 | and then proved the check can actually fail | a passing check proves nothing on its own, so each detector was fired deliberately: a broken markdown link, a broken html link, a retired claim, an impossible test count, and an evidence log no document references. All five caught, and the tree went green again once the faults were removed. `verify.sh` 11 → **12 steps**, all passing |
| 02:20 | `programs/commit-once/tests/versioned.rs` — the last compatibility gap that could actually block an integrator | the suite built `VersionedMessage::Legacy` everywhere, and the docs recorded v0 + address lookup tables as *"expected to work, but not verified"*. That is the wrong answer for the transaction shape **most production clients actually build**: v0 with a lookup table is how a transaction still fits inside the 1232-byte packet limit once it touches more than a handful of accounts. It was a real question rather than a formality, because `claim` reads the Instructions sysvar and because a lookup table **cannot supply a signer**, so the authority must stay static while the receipt PDA, the sysvar and the System Program are all loaded. Three tests now: the guard commits with everything loadable coming from a table; a rebuilt v0 retry is blocked with `AlreadyCommitted` and the counter stays at 1; and a signer listed in a table is not loaded from it |
| 02:30 | the lookup-table warmup, and a wrong assumption I had to correct | a table extended in the *current* slot is refused by the runtime, so the harness helper warps forward two slots — that is the single most common reason a v0 transaction fails the first time someone tries it. And my third test asserted that compiling a v0 message with the signer in a table would **fail**. It does not: `CompiledKeys::try_extract_table_lookup` only extracts non-signer keys, so the signer is silently kept static and compilation succeeds. That is the correct behaviour and a better property to pin, because a message that *did* load a signer would be unsignable and would fail far from its cause. Rewrote the test to assert the real guarantee. Rust suite 42 → **45** |
| 02:45 | the SDK was understating itself | four documents and the website said *"Non-Anchor callers: no such client has been written or run"*. I checked instead of assuming: the SDK has zero runtime dependencies, nothing in the repository imports `@coral-xyz/anchor`, and **every** occurrence of "Anchor" in `packages/sdk/src/` is a comment naming the discriminator it reproduces. The SDK *is* the non-Anchor client, and it runs against the deployed program on devnet. What is genuinely untested is different — a CPI into `claim` from another onchain program — so the two are now separate rows instead of one that made working code look like a gap |
| 03:00 | **a real security defect, found by writing a test rather than by reading the code** | `claim` decides whether a receipt exists with `data_is_empty()`. A receipt PDA is derived from `(authority, namespace, key)` and those are semi-public — an order id, a job id — so an attacker who learns them can compute the victim's address and **send it one lamport**. That creates a system-owned account with lamports and no data, which reads as "absent", so `claim` took the create path, and `CreateAccount` refuses an account that already holds lamports. **One lamport plus a fee would have permanently denied the victim that idempotency key.** The test failed against the deployed program on its first run with `Create Account: account ... already in use`. I had read this exact function earlier in the session and did not see it |
| 03:10 | the fix, and why it is complete | `claim` now tops a pre-funded PDA up to rent-exempt with a transfer paid by the authority, then `Allocate`s and `Assign`s it with `invoke_signed` under the PDA's own seeds — the sequence `CreateAccount` performs internally, split so the first step can be paid by the authority and the last two signed by the PDA. `Allocate` must precede `Assign`, since the System Program only allocates for an account it still owns. The vector is closed rather than narrowed: an attacker cannot do anything *except* send lamports, because `CreateAccount`, `Allocate` and `Assign` all require the account's own signature and only this program can produce one for its own PDA. Sending lamports now donates to the victim |
| 03:20 | one more reminder that the tests execute the artifact, not the source | after editing `claim.rs` the test still failed identically. The suite loads the compiled `.so`, so the fix was invisible until `scripts/build.sh` ran. That is the harness working exactly as designed, and it is worth recording because it is the kind of thing that could otherwise be mistaken for "the fix did not work" |
| 03:30 | redeployed, and recorded | the program changed, so the devnet deployment no longer matched the source. Redeployed `commit_once` at slot `502020368` (was `501995361`) and re-ran the guarded SOL transfer against it to confirm the live program still blocks a rebuilt retry. Every slot, signature, `.so` size and SHA-256 updated across the repository, including the new threat-model entry. Rust suite 45 → **46** |
| 04:00 | the repository is public | published at **<https://github.com/KaiVenn52/commitonce>** — `main`, Apache-2.0, public. The submission needed a repo link and there was none. Verified rather than assumed: local and remote `HEAD` match, an **anonymous** API request returns `200` (so a judge who is not signed in can read it), all 133 files are present, and the remote tree was compared blob-by-blob against local — including the ten PNGs, which a text-mode filter would have corrupted silently while git still reported success. Also added the three repository consistency checks to the CI workflow, which previously ran only the build and the test suites |
| 04:20 | a file in the repository was **not valid UTF-8** | scanning the tree before a public push turned up three truncated em-dashes in `scripts/check-docs.mjs` — the bytes `E2 80 3F`, the first two bytes of an em-dash followed by a literal `?`. Nothing noticed: it is a `.mjs` file, so the markdown link check does not cover it, and it still ran correctly because Node's UTF-8 decoder is lenient. Fixed, and `scripts/check-encoding.mjs` added so it cannot recur. A negative test then found a gap in **that** check: the naive binary test is "contains a NUL, therefore binary", which silently skips UTF-16 — and a UTF-16 file is exactly the defect this repository has already hit once, when an evidence log written by a Windows redirect was unreadable on Linux and binary to git |
| 04:40 | **CI failed, and it was right to** | the first CI run this workflow has ever produced came back red on two steps, neither of which `verify.sh` covered. **`cargo fmt --all --check`: 53 hunks across 8 files.** The workspace had never been rustfmt-clean, and nothing local ran the formatter. **Consumers typecheck: four `TS2307: Cannot find module '@commitonce/solana'` errors.** |
| 04:50 | the typecheck failure was an ordering bug, in CI **and** in `verify.sh` | `@commitonce/solana` resolves through `dist/types/index.d.ts`, and `dist/` is gitignored — so on a clean checkout the consumers cannot resolve the module until the SDK has been built, and both the workflow and `verify.sh` typechecked the consumers *first*. It passed locally for months because `dist/` was already there from an earlier build. Proved rather than assumed: deleting `packages/sdk/dist` reproduced the identical four errors locally, and building the SDK first made them disappear. The `TS7006` in `concurrent-claim.ts` was a cascade from the same cause, not a second bug. Both files reordered, and `cargo fmt --all --check` added to `verify.sh` so the next formatting drift is caught before a push. `verify.sh` 13 → **14 steps** |
| 05:30 | pointing the Jupiter example at a **real** transaction found a real bug | the example had been labelled structural, and the reason given was that this repository does not own Jupiter's API format — which is true, and still true. What was missing was the other half: nobody had ever fed it an actual Jupiter transaction. `scripts/fetch-jupiter-swap.mjs` now calls Jupiter's live aggregator API, and the first run failed with `invalid transaction: Transaction contains a duplicate instruction (3) that is not allowed`. Jupiter's transaction already carries `SetComputeUnitLimit` and `SetComputeUnitPrice`, and the example **unconditionally prepended its own** price instruction. The runtime rejects the whole transaction; it does not let the last one win. The code now adds a price instruction only when the supplied transaction does not already set one, so the guard is the only instruction this example adds |
| 05:40 | and the comment documenting it was wrong in the same way | the comment above `setComputeUnitPriceInstruction` said *"if the supplied transaction already contains its own SetComputeUnitPrice, that one takes effect, because the last such instruction wins"*. That is not what happens — the transaction is rejected outright. A comment that confidently describes the wrong behaviour is worse than no comment, because it is the thing a reader checks instead of running it. Corrected, with the actual error message quoted |
| 05:50 | `--dry-run`: the composition is now verifiable by anyone | the full path needs two things that cannot currently coexist — Jupiter's aggregator is mainnet-only and CommitOnce is devnet-only — so the composition could not be exercised by anyone, including its author, without hand-waving. Dry run composes and signs exactly what the submit path would, prints it, and stops: no funds, no deployment, and the same `buildGuardedMessage` code path, because a dry run that used a different path would verify nothing. Against the real transaction: 8 supplied instructions → 9 composed, guard at index 0, supplied order and contents unchanged, no duplicate ComputeBudget. The transaction is committed as a fixture (922 bytes, route `Meteora DLMM → AlphaQ`, **unsigned** — verified by reading the wire format, not assumed) so the run needs Jupiter only once |
| 05:55 | the strongest illustration of the product's own premise came from taking two quotes | the same request, minutes apart, returned a **922-byte** transaction routed `Meteora DLMM → AlphaQ` and a **570-byte** transaction routed `Flux`. Different route, different size, different intermediate accounts, different compute budget — same user intent. That is precisely why fingerprinting the transaction bytes would break the guard, and it is now recorded as a measured observation rather than an assertion in a comment |
| 06:20 | **the CPI path is now tested, closing the last documented composability gap** | `docs/FAQ.md` said a PDA authority "works only if a program signs for it through CPI", and then admitted *"there is no such integration in this repository and no test for it"*. Several other documents went further and simply asserted that "a Squads vault can act as the authority" — an overstatement, since a PDA cannot sign for itself. `demo-counter` gained `increment_guarded`, which calls `commit_once::claim` itself and then increments in the same instruction, and `tests/cpi.rs` covers it four ways: the CPI commits and the action runs once; a rebuilt retry is blocked with `AlreadyCommitted` and the counter stays at 1; a different payload under the same key is a conflict rather than a duplicate; and the guard program account is constrained to `commit_once::id()` so a caller cannot point the "guard" at a different program. What is still **not** demonstrated is the `invoke_signed` step a vault specifically needs, and the docs now say exactly that instead of asserting the vault case |
| 06:35 | an unrelated crate's dependency changed `commit_once.so`'s hash | adding `commit-once = { features = ["cpi"] }` to `demo-counter` changed the commit_once artifact from `afc54451…` to `7e18f4d0…` without a line of its own source changing. That is worth knowing because Anchor's `cpi` feature implies `no-entrypoint`, so the fear was a stripped entrypoint and a dead program. Checked rather than assumed: the LiteSVM suite executes that artifact in 40 tests and they pass, so it is callable. The honest conclusion is that **the artifact hash is a function of the whole workspace dependency graph**, not of the program's own source — so it must be regenerated after any workspace change, and the recorded hash fingerprints one build rather than guaranteeing reproducibility |
| 06:50 | **PowerShell corrupted two files, and the encoding check caught both** | editing `SUBMISSION_FORM.md` and `check-docs.mjs` with `Set-Content` turned every em dash into `E2 80 3F` — not valid UTF-8. That is the second time this exact corruption has appeared here, so it is now a rule in `CONTRIBUTING.md` rather than a note: write repository files with Node. And the repair itself was a trap worth recording — restoring the third byte produces **valid** UTF-8, but as an em dash where the original was an en dash, and in one case the following character was consumed too, turning `2:00–2:59` into `2:00—:59`. The file decoded cleanly and every check passed. `scripts/check-encoding.mjs` now rejects an em dash adjacent to a digit, and a negative test confirms it fires on the real corruption and stays silent on en-dash ranges, hyphen ranges, and a correctly used em dash. The first version of that rule required a digit *immediately after* the dash and missed the very case it was written for <!-- encoding-check: allow-em-dash --> |
| 07:20 | **the durable-nonce policy, verified against a live cluster at last** | the repository had said for its whole life that a genuine durable-nonce transaction *"cannot be tested in LiteSVM 0.10.0"* — LiteSVM passes the transaction's own blockhash into the program environment, which makes the System Program's advance check and the runtime's nonce validation mutually exclusive. That was true, and it was also a dead end: the claim stopped there rather than asking whether a *cluster* could do what the harness could not. `apps/demo/nonce-policy.ts` does it. It creates a real nonce account on devnet, builds transactions whose blockhash **is** the stored nonce with `AdvanceNonceAccount` first, and simulates them. **Finite retention is refused with `DurableNonceUnsupported` (6002); `permanent` is accepted.** Two real nonce transactions, one difference, the policy confirmed in both directions. Raw output: [`evidence/devnet-nonce-policy-run.log`](evidence/devnet-nonce-policy-run.log) |
| 07:35 | and the reason the harness cannot do this turned out to be visible in the live run | trying to close the nonce account automatically failed with *"Withdraw nonce account: nonce can only advance once per slot"* — `NONCE_BLOCKHASH_NOT_EXPIRED` (0x7). That is the **same** constraint `tests/security.rs` cites as the reason a nonce transaction is inexpressible in LiteSVM, observed directly rather than described. It is a protocol rule, not a harness limitation, and the harness simply cannot work around it; against a cluster the workaround is a wait between two transactions. The script now leaves the nonce account for manual cleanup and prints the exact command, because a cleanup step that needs its own explanation is worse than an honest instruction — and shipping a cleanup that does not work would have been the dishonest option |

---

## 4. What the Contest Period produced, by component

| Component | Location | State |
| --- | --- | --- |
| Guard program (`claim`, `close_receipt`) | `programs/commit-once/` | built (SBPFv2), deployed to devnet, 50 tests passing |
| Demo counter program | `programs/demo-counter/` | built, deployed to devnet |
| TypeScript SDK `@commitonce/solana` v0.1.0 | `packages/sdk/` | built (ESM + CJS + types), 71 tests passing, **not published to npm** |
| Rust test suite | `programs/commit-once/tests/` | 50 tests, exit 0, executing the real compiled artifact in LiteSVM |
| SDK test suite | `packages/sdk/test/` | 71 tests, with golden vectors cross-checked by an independent implementation |
| A/B demo CLI | `apps/demo/` | written and **executed against devnet**; output recorded in `submission/evidence/devnet-demo-run.log` and summarised in `EVIDENCE.md` |
| Integration examples | `examples/` | four examples, typechecked as part of the workspace. `sol-transfer`, `spl-transfer` and `custom-program` **have been executed against devnet** (System Program; SPL Token + Associated Token; an arbitrary Anchor program); the Jupiter-swap example has never submitted a transaction |
| Verification | `verify.sh`, `scripts/` | one command, PASS/FAIL summary, non-zero exit on any step that did not run |
| Documentation | `docs/`, `README.md`, `SECURITY.md`, `RELEASE_RUNBOOK.md` | architecture, security model, concepts, API reference, quickstart, integration playbook, developer FAQ, prior art, release runbook |
| Submission package | `submission/` | this set of documents |

## 5. Verified results, with their dates

Recorded in [`EVIDENCE.md`](../EVIDENCE.md) (recorded 2026-09-20 UTC) and reproducible from the
working tree:

| Result | Value | Date recorded |
| --- | --- | --- |
| `commit_once` devnet deployment | slot `501814672`, signature `5N8nwtyQSnA9XvRGLJMqsZrGmz3zFG1zPgWzcNmqyRo9N6udGT6RhsCV6mo8G68mWEWcsDziM44M6cuuHW6Hb4uW` | 2026-09-20 |
| `demo_counter` devnet deployment | slot `503100411` (redeployed with the CPI instruction) | 2026-09-24 |
| Rust suite | 41 passing, exit 0 | 2026-09-20 |
| SDK suite | 71 passing | 2026-09-20 |
| `commit_once.so` | 153,472 bytes, SHA-256 `56bc2084e4f1d0b3345938e3e9406eb0af0686b410f1cb8c78cf4fe9129f25b5` | 2026-09-20 |
| `demo_counter.so` | 138,064 bytes, SHA-256 `13b2b469276cafe298a511b01c67bc4e7601b37316c1b24b3364fb31f84e04f4` | 2026-09-20 |
| Overhead (structural, exact) | +404 bytes, +4 accounts | 2026-09-21 |
| Overhead (compute units) | reported as a range: the earlier single figures were not reproducible | 2026-09-21 |
| A/B demo executed against devnet | A reached counter 2 without the guard, B reached 1 with it; four signatures in [`EVIDENCE.md`](../EVIDENCE.md) and [`evidence/devnet-demo-run.log`](evidence/devnet-demo-run.log) | 2026-09-21 |
| `verify.sh` full run | `RESULT: PASS (14 steps ran and passed)`, exit 0 | 2026-09-24 |
| A/B demo executed against devnet | A reached counter 2 without the guard, B reached 1 with it; four signatures in [`EVIDENCE.md`](../EVIDENCE.md) and [`evidence/devnet-demo-run.log`](evidence/devnet-demo-run.log) | 2026-09-21 |
| Live contention run | 5 attempts on one key: exactly 1 commit, 4 rejected onchain with `AlreadyCommitted`; spread over 2 slots | 2026-09-21 |
| `sol-transfer` example executed | phase 1 committed, phase 2 blocked; recipient gained exactly one transfer | 2026-09-22 |
| `spl-transfer` example executed | phase 1 committed, phase 2 blocked; source fell by exactly one transfer, no ATA rent paid on the retry | 2026-09-22 |
| `custom-program` example executed | phase 1 committed, phase 2 blocked; counter stayed at 1 across two different transaction shapes | 2026-09-22 |
| `commit_once` **redeployed** to devnet | slot `503101216`, signature `274PANsUJf4N9jtP8arkuSmzP15TctKk4vgHHJupYHt14JsgwieEYhm1pYmtYVxcwfFUbdUcdFzvNH1cfRTWpui9`, data length `163712` | 2026-09-22 |
| `commit_once.so` (current) | 160,008 bytes, SHA-256 `7e18f4d0c9cd17db6c03b3f2fe0bcb511d9264f9d0cf06ca5b8afc479035a0` | 2026-09-24 |
| Rust suite (current) | 50 passing, exit 0 | 2026-09-24 |
| v0 + address lookup tables | **Tested** in `tests/versioned.rs` — the guard commits with all non-signer accounts loaded from a table, and a rebuilt v0 retry is blocked | 2026-09-22 |
| Durable-nonce scan | changed to fail closed; the runtime's own instruction ceiling discovered by probing, not assumed | 2026-09-22 |

## 6. What was not done during the Contest Period

Listed because the rules penalise omission as much as invention, and because the honest version of
this log is more useful than the flattering one.

| Not done | Detail |
| --- | --- |
| **No mainnet deployment** | Not deployed, no mainnet keypair or funding. |
| **No security audit** | The program is unaudited. |
| **No npm publication** | The SDK exists and builds; it is not published. |
| **No users, integrations, revenue** | None. See [`TRACTION.md`](TRACTION.md). |
| **Concurrent claims of one key** | **Tested in two places.** In-process: `only_the_first_of_many_attempts_commits` builds five distinct signed transactions against one blockhash — one slot — and asserts exactly one commits while the other four each fail with `AlreadyCommitted`. Live: `apps/demo/concurrent-claim.ts` fires 5–8 competing transactions at real devnet validators and gets the same result. **Caveat:** the live runs landed across 2–3 slots, not one — a client cannot force a leader to pack its transactions together. The same-slot case rests on the in-process test. |
| **One of the four examples is not executed** | All four are typechecked against the SDK on every build. `sol-transfer`, `spl-transfer` and `custom-program` **have** been executed against devnet — see `submission/evidence/devnet-sol-transfer-run.log`, `devnet-spl-transfer-run.log` and `devnet-custom-program-run.log`. The Jupiter-swap example has never submitted a transaction, and its README says so. |
| **Transaction v1** | Not tested. |
| **Address lookup tables / v0** | **Tested** in `programs/commit-once/tests/versioned.rs`. |
| **Non-Anchor clients** | **Verified.** The SDK has zero runtime dependencies and imports nothing from Anchor's JS library — it hand-encodes everything and runs against the deployed program. |
| **CPI into `claim` from another program** | **Tested** in `programs/commit-once/tests/cpi.rs`. |
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
