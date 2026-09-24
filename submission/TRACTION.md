# CommitOnce — traction

Traction is a required judging field: *"Does the product already have demand or revenue? If so,
how durable are its revenue and user base?"* This document answers it truthfully, then gives the
concrete validation plan that a judge can hold the project to.

**The short answer: there is no traction. Zero.** No users, no integrations, no revenue, no
waitlist, no user feedback. Nothing below is dressed up to look like more than it is.

The product being tracked is a guard instruction that provides **at-most-once successful execution
of a guarded logical intent within the configured retention window** — not universal "exactly
once" execution. It is live on **devnet**, unaudited, and not on mainnet.

---

## 1. The honest position, stated as the field asks for it

| Question | Answer |
| --- | --- |
| Users | **0.** No external party has used CommitOnce. |
| Integrations | **0.** No project imports the SDK or sends the guard instruction. |
| Revenue | **0.** Nothing is for sale. The core is Apache-2.0 and free. |
| Waitlist / signups | **None exists.** No email capture, no landing page. |
| User feedback | **None collected.** No interviews, no survey, no community. |
| npm installs | **0.** The package is not published. |
| Mainnet usage | **0.** Not deployed to mainnet. |
| Audit | **Not performed.** |
| Team | **One founder, no team.** |
| Funding raised | **None.** |

If a judge reads only one line of this document, it should be that table.

---

## 2. What does exist, and why it is evidence rather than a substitute for traction

Traction and engineering evidence are different things, and conflating them is how submissions
lose credibility. What exists is verifiable work:

| Artifact | Status |
| --- | --- |
| Guard program, deployed on **devnet** | live and executable; deploy slot `503174994`; signature `274PANsUJf4N9jtP8arkuSmzP15TctKk4vgHHJupYHt14JsgwieEYhm1pYmtYVxcwfFUbdUcdFzvNH1cfRTWpui9` |
| Demo counter program, devnet | `EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5`, slot `503175063` |
| Rust test suite | **60 passing, exit 0**, executing the real compiled SBF artifact through LiteSVM |
| SDK test suite | **71 passing**, golden vectors cross-checked by an independent implementation |
| Measured overhead | +404 bytes, +4 accounts (usually +3); `claim` ~14,000 CU on devnet |
| Receipt | 202 bytes, 1,676,400 lamports, fully refundable |
| Prior-art survey | primary-source survey with the closest deployed competitor enumerated, including its weaknesses and its advantages |
| One-command reproduction | `bash verify.sh` |

Everything above is reproducible, and
[`EVIDENCE.md`](../EVIDENCE.md) §7 lists what is **not** verified — which is the document's most
useful section, because a list of successes is not evidence.

**Why this is the honest artifact set for this stage.** CommitOnce is a primitive, not an
application. A primitive has no users until somebody integrates it, and integration requires the
primitive to be installable, documented and trusted. The work that can be done before a first
integrator exists is exactly: prove the invariant, measure the cost, publish the security model,
publish the prior art, and deploy somewhere it can be tried. That is done. What cannot be
manufactured is adoption.

**And why a judge should not read zero as "no attempt".** The substitute for traction in this
submission is not adjectives; it is a specification a reviewer can falsify. §4 below is dated,
numbered and gated.

---

## 3. The market observation that supports the thesis (not traction)

One finding from the prior-art survey is worth stating precisely, because it is evidence about the
market rather than about CommitOnce, and it is checkable:

**The market is empty of products, not of mechanisms.** Registry searches found no shipped Solana
onchain idempotency primitive on crates.io or npm; GitHub repository searches for
`solana+nonce+manager`, `solana+guard+instruction+program`, `solana+idempotency+program+anchor`,
`solana+at-most-once` and `solana+exactly+once+execution` returned zero relevant results;
`solana.com/docs` never mentions idempotency; and none of roughly 130 SIMDs proposes it. The
closest deployed artifact, Light Protocol's `nullifier-program`, has **71 crate downloads** and an
npm package last published **2026-02-05** — roughly seven months live on mainnet with negligible
adoption and no product surface.

That cuts both ways, and the honest reading is the pessimistic one: **a category with a live
incumbent and near-zero adoption is evidence that adoption is hard, not that the opportunity is
large.** It may mean the problem is under-appreciated; it may mean developers do not care enough
to add a dependency. §4 is designed to distinguish those two cases, and §5 says what happens if it
turns out to be the second.

---

## 4. The validation plan

Ten conversations. Numbered, dated, and falsifiable — the count matters because "we talked to
users" is unverifiable while "eight of ten named a specific duplicate incident" is not.

### Stage 1 — Ten recorded conversations, by 2026-11-15

Target profiles are in [`GTM.md`](GTM.md) §3: ten teams covering a payments processor, a trading
bot, a game backend and a relayer at minimum. Sourced from public retry code in open-source Solana
repositories, the hackathon builder cohort, and developer channels.

**The five questions, asked in this order** (the first two are the ones that produce evidence):

1. Walk me through what your client does when a transaction send times out.
2. Have you ever had an action execute twice, or suspected it did? What did it cost?
3. How do you currently decide it is safe to retry?
4. If a rebuild could not double-execute, what would you change in your code?
5. What would have to be true for you to add one instruction to your transaction?

**What counts as a result:**

| Outcome | Threshold | What it means |
| --- | --- | --- |
| **Validated** | ≥6 of 10 describe a specific duplicate or a specific unresolved ambiguity, and ≥3 will test the guard on a real flow | The problem is real and the product shape fits. Proceed to Stage 3. |
| **Partially validated** | ≥6 describe the ambiguity, but <3 will test | The problem is real; the *guard* is the wrong shape. Investigate whether they want detection and alerting instead of prevention. |
| **Not validated** | <6 describe the ambiguity, or they describe it and say retries are already safe enough | The primitive is premature. Publish the finding. |

The negative result is written down in advance on purpose. A validation plan whose failure mode is
undefined is not a plan.

### Stage 2 — Shadow mode, by 2026-12-15

One team runs the guard on a non-critical flow for two weeks, watching for:

- **`AlreadyCommitted` on a retry** — the guard firing as designed. This is the direct measurement
  of how often the bug would have happened, in production, on real traffic.
- **`IdempotencyConflict`** — an integrator fingerprint mistake, caught before it costs anything.
  This is the most valuable signal available, because it is the failure mode that would make the
  guard actively harmful if it reached a critical path undetected.

**Reported as:** "N retries in two weeks, M of which would have double-executed without the
guard." That single sentence is the traction number this product actually needs, and it is
measurable without a single paying customer.

### Stage 3 — First guarded production flow, by 2027-Q1

One team, one critical flow, with the guard in front of real value. Gated on Stage 1 and Stage 2
passing, and on the audit status being disclosed to that team in writing.

### Stage 4 — Trust, before scale

An audit of the `commit-once` program and the SDK's hashing and PDA derivation, scoped as in
[`NEEDS_OWNER_ACTION.md`](../NEEDS_OWNER_ACTION.md) §6. **Until it happens, nothing here should be
put in front of real value, and this document says so rather than leaving it implied.** If the
budget does not exist, the correct action is to say that publicly, not to imply an audit occurred.

---

## 5. What would falsify the thesis

Written down so the plan can fail honestly:

1. **Ten conversations, no duplicate failure found** (Stage 1 "not validated"). Then the problem is
   real but rare, a dedicated primitive is the wrong shape, and the right move is to say so and
   consider pivoting to detection rather than prevention.
2. **Teams describe the ambiguity but will not add an instruction.** Then the cost of adoption —
   one dependency, one fingerprint discipline — exceeds the perceived risk, and the honest
   conclusion is that the product must be invisible (inside a wallet, a relayer, or a template)
   rather than a thing developers choose.
3. **A maintained protocol ships authority-scoped, RPC-free idempotency with retention.** The
   project's stated kill condition. Assessed as not triggered against the current landscape in
   [`docs/PRIOR_ART.md`](../docs/PRIOR_ART.md) §5; if that changes, the assessment must be re-run
   and published.
4. **Solana adds intent-level deduplication to the runtime.** Then the guard becomes a bridge, and
   the honest response is to say so and re-scope — see [`FAQ.md`](FAQ.md).

---

## 6. How a judge can verify that none of this is overstated

| Claim | How to check it |
| --- | --- |
| Devnet deployment is real | `solana program show CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB --url devnet`, and the deploy signature on any devnet explorer |
| Tests pass | `bash verify.sh` — one command, no cluster, no secrets |
| Overhead figures | `bash scripts/test.sh --test benchmarks -- --nocapture` |
| No users or integrations | search the repository and the npm registry; `@commitonce/solana` is not published |
| No mainnet deployment | the same `solana program show` against mainnet-beta returns nothing |
| No audit | [`SECURITY.md`](../SECURITY.md) and [`docs/SECURITY_MODEL.md`](../docs/SECURITY_MODEL.md) both open by saying so |
| Nothing is hidden about prior art | [`docs/PRIOR_ART.md`](../docs/PRIOR_ART.md) §0 leads with the fact that the mechanism is not novel |

## 7. What will not be done to improve this document

No purchased stars, reviews or downloads. No invented metrics, pilots, letters of intent, or
"design partners". No logos of teams that have not integrated. No retrospective claim that a
conversation was a customer. The rules are explicit that misrepresenting development history or
failing to disclose relevant information is grounds for disqualification, a ban from future
Colosseum hackathons, and prize revocation — and, more importantly, the entire credibility of a
reliability product rests on it being trustworthy about its own numbers.
