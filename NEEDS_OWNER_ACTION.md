# Needs owner action

Everything in this file is blocked on something **outside** this repository: a credential, a
payment, an account, or a decision that only the owner can make. Everything else — the
program, the SDK, the tests, the docs, the devnet deployment, the benchmarks — is already
done and verified (see [`EVIDENCE.md`](EVIDENCE.md)).

Each item states exactly what is blocked, why it cannot be done from here, and the precise
command or action required.

**Nothing in this file is a guess.** Each blocker was confirmed by attempting the action and
reading the actual failure. Where an attempt succeeded, the item is not listed here.

---

## Status summary

| # | Blocker | Blocks | Cost | Time |
| --- | --- | --- | --- | --- |
| 1 | Colosseum account + submission form | the submission itself | free | ~1 hour |
| 2 | Presentation + demo videos | the highest-weighted judging input | free | ~4 hours |
| 3 | npm publish token | SDK distribution | free | ~15 min |
| 4 | Mainnet SOL + deployment decision | mainnet launch | ~2–3 SOL + rent | ~1 hour |
| 5 | Domain | product website | ~$12/year | ~20 min |
| 6 | Security audit | production trust | $15k–$60k | weeks |
| 7 | Legal / entity | pre-seed, token, or paid contracts | varies | — |

**Done, and no longer blocked:** the repository is published. It is public at
**<https://github.com/KaiVenn52/commitonce>**, default branch `main`, Apache-2.0, with CI
configured to run on every push.

Items 1 and 2 are the highest leverage by a wide margin: the Colosseum FAQ states the pitch
video is *"the most important element"* of a submission, and products are judged **only on
work completed during the Contest Period**.

---

## 1. Submit to Colosseum

**Blocked on:** your Colosseum account. The submission form requires an authenticated
session; it cannot be driven from here.

**Confirmed deadline:** Contest Period ends **11:59pm PT 2026-10-12** (`2026-10-13T06:59:00Z`).
Winners announced by **2026-12-05**.

**What is already prepared for you:**

**Start here: [`submission/SUBMISSION_FORM.md`](submission/SUBMISSION_FORM.md)** — the exact text
for every field the portal asks for, ready to paste. Everything below is the longer-form source
that document draws from.

| Field | Source |
| --- | --- |
| **Form answers, ready to paste** | [`submission/SUBMISSION_FORM.md`](submission/SUBMISSION_FORM.md) |
| GitHub repo link | <https://github.com/KaiVenn52/commitonce> |
| Project description | [`submission/PROJECT_DESCRIPTION.md`](submission/PROJECT_DESCRIPTION.md) |
| Technical overview | [`submission/TECHNICAL_OVERVIEW.md`](submission/TECHNICAL_OVERVIEW.md) |
| Pitch script (2:00–2:59) | [`submission/PITCH_SCRIPT.md`](submission/PITCH_SCRIPT.md) |
| Demo script (≤3 min) | [`submission/DEMO_SCRIPT.md`](submission/DEMO_SCRIPT.md) |
| Shot list | [`submission/VIDEO_SHOTLIST.md`](submission/VIDEO_SHOTLIST.md) |
| Go-to-market | [`submission/GTM.md`](submission/GTM.md) |
| Traction (honest) | [`submission/TRACTION.md`](submission/TRACTION.md) |
| Founder story | [`submission/FOUNDER_STORY.md`](submission/FOUNDER_STORY.md) |
| FAQ | [`submission/FAQ.md`](submission/FAQ.md) |
| Judge entry point | [`submission/JUDGE_README.md`](submission/JUDGE_README.md) |
| Compliance check against the official guides | [`submission/COLOSSEUM_GUIDES_BRIEF.md`](submission/COLOSSEUM_GUIDES_BRIEF.md) |
| Logo to upload | [`assets/brand/commitonce-mark-1024.png`](assets/brand/commitonce-mark-1024.png) |

**Actions required:**

1. ~~**Push the repository to GitHub.**~~ **Done.** It is public at
   **<https://github.com/KaiVenn52/commitonce>**, default branch `main`, Apache-2.0. The
   repository link to submit is:

   ```
   https://github.com/KaiVenn52/commitonce
   ```

   Verified after pushing: the local and remote `HEAD` match, an **anonymous** request to the
   API returns `200` (so it is readable by a judge who is not signed in), all 133 tracked files
   are present, and `README.md` renders.

   The name is `KaiVenn52/commitonce` rather than the `commitonce-dev/commitonce` this file
   previously suggested: the authenticated GitHub account is `KaiVenn52`, and creating an
   organisation was not necessary to publish. If an organisation is created later, GitHub
   redirects the old URL, so a link already submitted keeps working.

   Before the submission, re-check it in a **private browser window** to prove it resolves for
   someone who is not you.
2. Record the two videos (item 2 below) and upload them; get the URLs.
3. If the repository is ever made private, grant read access to **`hackathon@colosseum.com`**.
   It is public today, so nothing is needed.
4. Fill the form at <https://colosseum.com> and submit **before 11:59pm PT on 2026-10-12**.

**Two compliance points that are easy to get wrong:**

* **Disclose pre-existing work.** Any code written before the Contest Period must be
  disclosed. [`WORK_LOG.md`](submission/WORK_LOG.md) records what was built when.
* **All content must be in English.** The repository is English throughout; keep the video
  narration in English too.

---

## 2. Record the presentation and demo videos

**Blocked on:** you. These require a human voice and a screen recording.

The submission requires **both** a 2–3 minute presentation video and a ≤3 minute product
demo video. Per the Colosseum FAQ the pitch video is *"the most important element"* of a
submission — treat it as the highest-value hour you will spend on this project.

**Scripts are written and timing-checked.** Follow
[`submission/VIDEO_SHOTLIST.md`](submission/VIDEO_SHOTLIST.md).

**Before recording, run the demo and confirm it works:**

```bash
export PAYER_KEYPAIR=~/.config/solana/id.json
node apps/demo/commitonce-demo.ts
```

The demo hits **devnet** and prints real explorer links. Record the terminal, not a slide. It
must end with `CommitOnce demo: both scenarios behaved exactly as claimed.` See
[`apps/demo/README.md`](apps/demo/README.md) for the options and exit codes.

If you want a second, stronger shot for the technical demo, `node apps/demo/concurrent-claim.ts`
fires one idempotency key at real validators in 5–8 transactions at once. Read the caveat it
prints before putting it on camera; [`submission/DEMO_SCRIPT.md`](submission/DEMO_SCRIPT.md) §2b
has the wording.

**Also: submit the weekly updates.** The FAQ asks for a *"concise, one-minute video"* each week
and says they are *"strongly recommend[ed] … for anyone serious about competing"*. They are not
required and not a scored criterion, but they are the only channel that puts work in front of
Colosseum *during* the Contest Period rather than at the end. See
[`docs/COLOSSEUM_REQUIREMENTS.md`](docs/COLOSSEUM_REQUIREMENTS.md) §10.

---

## 3. Publish the SDK to npm

**Blocked on:** an npm account with publish rights to the `@commitonce` scope. Publishing
requires an authenticated token, which cannot be created or stored from here.

**Name availability is verified and clear.** As of the check, the unscoped names
`commitonce` and `commit-once`, and the entire `@commitonce` scope, are **unclaimed**. A
GitHub repository search for the name returns `total_count: 0`. crates.io, PyPI and Docker
Hub are clear.

**One caveat, now moot for the repository:** the GitHub *user* handle `@CommitOnce` is taken by a
dormant account. That only matters if a dedicated account or organisation is created for this
project; the repository is published under the owner's existing account as
`KaiVenn52/commitonce`, and the npm scope `@commitonce` is a separate namespace that is still
unclaimed.

**Actions required:**

```bash
# 1. Create the scope. Either claim the org name on npm, or create a free org named
#    "commitonce" at https://www.npmjs.com/org/create
npm login

# 2. Verify you can publish to the scope (this is the real gate):
npm whoami

# 3. Build and publish. --access public is required for a scoped package.
cd packages/sdk
pnpm install
pnpm run build
npm publish --access public
```

Then update the install instructions in `README.md` and `docs/QUICKSTART.md`, which
currently describe the package as unpublished.

**Do not publish until** the version in `packages/sdk/package.json` is the one you intend to
keep, because the first published version of a name is permanent.

---

## 4. Mainnet deployment

**Blocked on:** mainnet SOL, which must be purchased, plus a deliberate decision to spend it.

**Verified cost, from the actual devnet deployment:**

| Item | Amount |
| --- | --- |
| `commit_once` program account | 0.7805166 SOL |
| `demo_counter` program account | 0.70224396 SOL |
| Total for both | 1.48276056 SOL |
| Buffer / retry headroom | ~1.0 SOL |
| **Recommended budget** | **~2.5–3 SOL** |

**Actions required:**

```bash
# 1. Generate FRESH program keypairs. Do NOT reuse the committed devnet ones.
#
#    This is a supply-chain precaution, not a formality. A program's address is derived from
#    its keypair, and deploy-keys/ is committed so that a fresh clone can build. If the
#    mainnet address were derived from a publicly known keypair, anyone could deploy
#    arbitrary code to that exact address on mainnet before you do — and integrators who
#    trust the address would then be calling an attacker's program.
solana-keygen new --no-bip39-passphrase -o deploy-keys/commit_once-mainnet-keypair.json
solana-keygen new --no-bip39-passphrase -o deploy-keys/demo_counter-mainnet-keypair.json

# 2. Update declare_id! in both programs and in Anchor.toml to the new addresses, then:
bash scripts/build.sh          # exits 1 if declare_id! and the keypairs disagree

# 3. Point the CLI at mainnet and confirm the deployer is funded.
solana config set --url https://api.mainnet-beta.solana.com
solana address
solana balance

# 4. Deploy.
solana program deploy target/deploy/commit_once.so \
  --program-id deploy-keys/commit_once-mainnet-keypair.json \
  --url https://api.mainnet-beta.solana.com

solana program deploy target/deploy/demo_counter.so \
  --program-id deploy-keys/demo_counter-mainnet-keypair.json \
  --url https://api.mainnet-beta.solana.com
```

Step 2 changes the program address, so any receipt, explorer link or document quoting
`CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB` refers to the **devnet** program and would
need updating for mainnet.

**Three decisions to make before deploying, not after:**

1. **Upgrade authority.** Both devnet programs are upgradeable with the deploying key as
   authority. Decide whether mainnet should be upgradeable (retain the key, keep the ability
   to fix bugs) or immutable (`solana program set-upgrade-authority --final`). An immutable
   program is a stronger trust claim but cannot be patched. This is a genuine trade-off with
   no default answer.
2. **Audit timing.** See item 6. Deploying before an audit means users are exposed to
   unaudited code, and `SECURITY.md` must say so plainly.
3. **Squads / multisig authority.** For anything holding real value, the upgrade authority
   should be a multisig rather than a single hot key. A Squads vault can also act as a
   (the `invoke_signed` CPI path a PDA authority needs is tested in `tests/cpi.rs`)
   CommitOnce *authority*, but note that individual vault member keys cannot share one
   receipt — see the limitations in `README.md`.

**Do not deploy to mainnet merely because it is possible.** The honest sequencing is: audit
first for anything holding value, or deploy with an explicit public "unaudited, use at your
own risk" notice and a bug bounty.

---

## 5. Domain for the product website

**Blocked on:** a domain purchase. This requires a payment method.

**Actions required:**

1. Register a domain. `commitonce.dev` or `commitonce.xyz` are the natural choices; verify
   availability at purchase time, since availability changes.
2. Point it at the site, then update the canonical URL wherever it appears.

Until then, the site should not claim a domain it does not have. Do not put a placeholder URL
in the submission — judges click links.

---

## 6. Security audit

**Blocked on:** budget and vendor selection. Audits cost money and time, and neither can be
produced from here.

**Current state:** the program is **unaudited**, and `SECURITY.md`, `README.md` and
`docs/SECURITY_MODEL.md` all say so explicitly. This is disclosed rather than hidden.

**What is ready for an auditor:**

* `docs/SECURITY_MODEL.md` — a full threat model (T1–T10), the intended guarantee stated
  precisely, and §8 listing the specific failure modes that would break it, each paired with
  the test that guards it.
* `docs/ARCHITECTURE.md` — every design decision and its rationale, including the ones where
  the obvious choice was rejected (`init_if_needed`, a separate rent payer, signature-based
  dedup reasoning).
* 60 tests that execute the real compiled artifact, all asserting on observable onchain
  state.
* `EVIDENCE.md` §7 — an explicit list of what is **not** verified, which is where an auditor
  should start.

**Recommended scope:** the `commit-once` program (highest value), then the SDK's hashing and
PDA derivation. The demo counter and third-party dependencies are out of scope.

**Note on audit shopping:** if the budget does not exist, say so in the submission rather
than implying an audit happened. Judges and investors both check.

---

## 7. Legal, entity, and commercial

**Blocked on:** you. Not technical, and not something this repository can resolve.

* No entity, no terms of service, no privacy policy exists. A hosted product needs them.
* No licence for the SDK beyond the repository's Apache-2.0.
* If CommitOnce ever takes a fee, holds user funds, or operates infrastructure, the
  regulatory position needs real legal advice — a program that only writes PDAs and refunds
  deposits is a different risk profile from one that custodies value, but that boundary
  should be drawn by a lawyer, not by a README.

---

## What is *not* blocked

Recorded here so it is not mistaken for a blocker:

| Capability | Status |
| --- | --- |
| Program build | Works. SBPFv3, IDs verified against `deploy-keys/`. |
| Rust test suite | **60 passing, exit 0.** Executes the real compiled artifact. |
| SDK build (ESM + CJS + types) | Works. Verified by importing both ways. |
| SDK test suite | **79 passing**, golden vectors cross-checked by an independent implementation. |
| Devnet deployment | **Done and verified.** See `EVIDENCE.md` §3. |
| Benchmarks | Measured. See `EVIDENCE.md` §6. |
| Documentation | Written. |
| Colosseum requirement compliance | Audited against the official guides; see `submission/COLOSSEUM_GUIDES_BRIEF.md`. |
