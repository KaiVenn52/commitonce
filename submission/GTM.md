# CommitOnce — go-to-market and distribution

**What is being sold:** a reliability primitive. One instruction prepended to a transaction that
already exists, which makes a rebuilt retry unable to execute the same logical intent a second
time — at-most-once successful execution of a guarded logical intent, within the configured
retention window.

**Who buys it:** the engineering team that already retries Solana transactions and has already
been burned, or is one incident away from being burned, by a duplicate.

**Honest starting position:** zero users, zero integrations, zero revenue, no audit, no mainnet
deployment. This document is the plan, not a report. The truthful traction statement and the
validation plan that gates everything below are in [`TRACTION.md`](TRACTION.md).

---

## 1. The wedge, and why it is narrow on purpose

CommitOnce is infrastructure, and infrastructure does not spread by itself. The narrow wedge is
the moment a developer discovers that a transaction they thought failed actually landed — or
that a retry landed twice. That moment is the entire go-to-market:

1. It is a **bug they already have**, not a capability they have to want.
2. It is **diagnosable** — a duplicated payment, a double mint, a doubled position.
3. The fix is **one instruction**, and requires **no change to their program**, which is the
   single strongest argument for adoption: no redeploy, no migration, no audit of their own code.

So the motion is not "advertise a primitive". It is: find the teams that have this bug, show them
it is theirs, and hand them a 20-minute fix.

---

## 2. Why four different archetypes care — for four different reasons

These are not the same objection in four costumes. Each archetype has a distinct failure mode, a
distinct cost of the failure, and therefore a distinct reason to adopt.

### Payments processor

**The failure:** settlement is a money movement. A rebuilt retry that lands twice pays an
invoice twice. The second payment is real, on chain, and irreversible.

**Why it is worse than a bug:** it is not only a technical defect. It breaks reconciliation (the
ledger and the chain disagree), it forces a manual refund flow that itself needs idempotency, and
it is user-visible — the customer sees a double charge. For a regulated or audited business, the
second payment is an incident with paperwork.

**Their reason to care:** correctness of money movement, and an audit trail. They already think in
idempotency keys — Stripe taught them the pattern — and CommitOnce is the same concept where the
transaction actually happens. **This is the beachhead**: they have the vocabulary already.

### Trading bot

**The failure:** a duplicated order is an unintended second position. A rebuild is not an edge
case here; it is the designed behaviour — bots retry aggressively, change priority fees, and
rotate routes under load, which is exactly what changes the message hash.

**Why it is worse than a bug:** risk limits are computed per intent. If one intent can execute
twice, every risk calculation is wrong in the tail, and the loss is market exposure rather than a
refund. There is no counterparty to ask for the money back.

**Their reason to care:** position integrity under retry pressure. They care about the *compute
and byte cost* of the guard more than any other segment, and they are the segment most likely to
run it in a hot path — which is why the measured overhead is published
([`TECHNICAL_OVERVIEW.md`](TECHNICAL_OVERVIEW.md) §12) rather than described as "negligible".

### Game backend

**The failure:** a reward, drop, or mint granted twice. The backend that grants it is an ordinary
web service with a retry policy; the action is an onchain mint.

**Why it is worse than a bug:** it is an **exploit surface**. Duplicate mints are an economy
inflation bug and, once someone notices, a deliberately triggerable one — the player does not need
to hack anything, they only need to make the request time out. Duplicates in a game economy are
also socially visible and hard to claw back without punishing legitimate players.

**Their reason to care:** exploitability, not just reliability. A duplicate is a free-money bug
that any player can attempt.

### Relayer

**The failure:** a relayer pays the fee for someone else's action. A duplicate costs the relayer
real SOL *and* executes the user's action twice, so the relayer absorbs a cost it cannot bill and
causes a defect it did not author.

**Why it is worse than a bug:** the relayer has the least information. It receives a signed
transaction, not an intent; it cannot ask the user's application whether the first attempt landed;
and it is explicitly told by its own vendors to *"handle retries in your own code"* — Helius and
Triton both document the hazard and hand it back. The relayer is structurally the party that
cannot fix this at its own layer.

**Their reason to care:** they can offer a **guarantee as a product feature** — "we will not
double-execute your intent" — which is differentiation they cannot get from fee optimisation. They
are also the best distribution channel in the list: one relayer integration reaches every
application behind it. Note that a relayer can pay the transaction *fee* while the authority pays
the receipt rent, so the two roles are already separated by design.

### Two more that follow directly

- **Agent frameworks and automation platforms** pay autonomously and retry without a human in the
  loop. An agent that double-pays has no one to notice, which makes the guard a safety control
  rather than a convenience.
- **Wallets and custody providers** expose a "retry" button, which means the duplicate risk is
  handed to a non-technical user who has no way to reason about it.

---

## 3. The first ten users, concretely

Ten is a number chosen for a reason: it is the smallest set that covers all four archetypes, and
it is achievable by one founder without a budget. Each entry states who, where to find them, the
specific pain, and the first ask. **No customer, partner or company is named here, because none
exists.** These are target profiles and the places they are actually reachable.

| # | Who | Where they are reachable | The pain that makes them listen | The first ask |
| --- | --- | --- | --- | --- |
| 1 | A payments/checkout team settling in USDC on Solana | Solana payments builders in the Colosseum/Superteam community; teams that publish a checkout SDK | A rebuilt retry can pay an invoice twice; reconciliation breaks | "Show me your retry path. I will tell you whether it can double-send." |
| 2 | A subscription or recurring-billing app | Teams posting about onchain billing; Solana Pay integrations | A recurring charge retried after a timeout can charge twice in one period | Same, scoped to one recurring charge |
| 3 | A payroll or streaming-payment operator | Builders in the treasury/payments sections of the Colosseum resource index | A missed payroll run is retried — and can pay a whole cycle twice | Run the A/B on their transaction shape |
| 4 | A trading-bot operator (arbitrage or liquidations) | Public bot repos, Solana trading Discords, X accounts that publish bot results | A duplicated order is unintended market exposure, not a refund | Quantify the guard's CU/byte cost on their real instruction set |
| 5 | A game backend that grants onchain rewards | Solana gaming Discords; hackathon game teams | A duplicate mint is a player-triggerable exploit, not a rare race | Threat-model one reward flow together |
| 6 | A launchpad or NFT mint operator | Mint platforms and their public post-mortems about duplicate mints | Duplicate mints inflate supply and are politically expensive to reverse | Review one mint path for the rebuild case |
| 7 | A relayer or transaction-delivery operator | RPC/relayer Discords and the vendors named in [`docs/PRIOR_ART.md`](../docs/PRIOR_ART.md) §2.3–2.5 | They pay for duplicates they cannot see and cannot bill | Offer the guard as a value-add on their retry path |
| 8 | An agent framework or automation platform that pays | Agent/tokenization builders in the Colosseum resource index | Autonomous retries with no human in the loop; a double payment is invisible | Add the guard to their payment tool |
| 9 | A wallet or custody provider with a retry button | Wallet teams; Phantom Connect and similar builder programs | The duplicate risk is pushed onto a non-technical user | Prototype the guarded retry in their client path |
| 10 | A maintainer of a popular Solana starter template or boilerplate | GitHub, by searching for templates that include a retry helper | Making the guard the default protects every project built from the template | A PR that adds the guard to their retry example |

**How to find them without guessing.** Three concrete sourcing methods, in order of yield:

1. **Read the retry code that is already public.** Open-source Solana applications that rebuild a
   transaction on timeout have the bug in their repository, in the open. A team that can be shown
   the exact line where their retry changes the message hash has no argument to make. This is
   research, not outreach — it produces a specific, checkable claim about *their* code.
2. **The hackathon's own builder pool.** The Crypto World's Fair page reports **4,585 builders**,
   and the contest rules scope submissions to one per team, so this cohort is a bounded,
   reachable, already-motivated set of teams — most of them running transaction code written in
   the last four weeks, which is exactly when a duplicate bug gets written.
3. **Answer the question where it is already being asked.** Search for the symptom ("sent twice",
   "did my transaction go through", "AlreadyProcessed" confusion) in Solana developer channels and
   answer it with the mechanism, not with a pitch. The write-up in §4 is the artifact for this.

---

## 4. The developer-adoption motion

**Top of funnel: one canonical write-up, not a landing page.** A precise explanation of *why a
rebuilt transaction can execute twice*, quoting Agave's source comment and Solana's own
production-readiness guidance, with a reproduction. It is genuinely useful to a developer who does
not care about CommitOnce, which is why it travels. It is also the honest top of funnel for a
primitive: the audience arrives already convinced the problem exists, so the only remaining
question is whether this implementation is the right one.

**The conversion step is a 20-minute integration.** Five lines, and nothing in the developer's own
program changes:

```ts
import { createCommitOnceClient } from '@commitonce/solana';

const commitOnce = createCommitOnceClient({ rpc });
const claim = await commitOnce.prepare({
  namespace: 'payments',
  key: orderId,                       // stable across retries — this is the whole discipline
  intent: { recipient, amount, mint, memo },   // semantic fields only
});
const transaction = [claim.instruction, ...yourBusinessInstructions];
```

The discipline is one sentence long: *put semantic fields in the fingerprint, never transport
details.* Everything else is a prepend.

**The adoption ladder**, in the order a cautious engineer climbs it:

1. **Read** — the write-up, and the prior-art survey so they know exactly what is and is not new.
2. **Verify locally** — `bash verify.sh`, 60 Rust tests and 79 SDK tests, no cluster needed, no
   secrets, no signup.
3. **Try on devnet** — the guarded example against devnet, with real explorer links.
4. **Shadow mode** — run the guard on a non-critical flow for a week and watch for
   `IdempotencyConflict`, which is how an integrator finds out their fingerprint is wrong before it
   costs anything.
5. **Guarded production path** — one critical flow, then more.

**Distribution channels, cheapest first:**

| Channel | Why it fits this product |
| --- | --- |
| npm (`@commitonce/solana`) | The install step is the adoption step. Not published yet — a named blocker. |
| GitHub, Apache-2.0 | The rules score open-source and composability; a primitive that cannot be read is not trusted. |
| The repository's own docs | The integration playbook, security model and API reference already exist and are the sales material. |
| Starter templates and boilerplates | The highest-leverage channel: it makes the guard the default instead of a decision. |
| RPC providers and relayers | They already own the retry conversation and are told by their own docs to push it to the caller. |
| Colosseum / Superteam / the hackathon cohort | A bounded, reachable, currently-motivated set of builders. |
| Grants and public-goods funding | The core is Apache-2.0 and useful to the ecosystem whether or not it is monetised. |

**What we will not do:** pay for stars or reviews, invent usage numbers, publish a logo wall of
"partners" who have not integrated, or describe an unintegrated team as a customer. The
submission's credibility rests on the repository being checkable, and one fabricated number
destroys that.

---

## 5. Business model

**Open core, and the core stays free.** The program, the SDK, and the derivation are Apache-2.0
and free forever. Charging for the ability to not double-spend is charging for safety, which
suppresses exactly the adoption a primitive needs. There is no revenue today and none is claimed.

Revenue, if the primitive is adopted, comes from what surrounds it rather than from the guard:

| Line | What it is | Who pays |
| --- | --- | --- |
| **Receipt observability** | A read API and alerting over receipt state: which intents committed, which are near expiry, which keys are held by conflicting payloads. A conflict alert is the feature — it means a real action was about to be dropped. | Teams running the guard in production |
| **Cleanup automation** | A keeper that closes expired receipts and reclaims rent, with monitoring. The deposit is refundable, so this is operational convenience with a measurable saving. | High-volume issuers with many live receipts |
| **Support and production readiness** | Integration review, fingerprint design review, and help preparing for an audit. | Teams putting the guard in front of real value |
| **Managed or self-hosted index** | The same read API, deployed in the customer's own infrastructure. | Regulated or security-sensitive teams |

**Why this is a real business and not a feature:** the primitive is the wedge, and the durable
asset is the operational surface around it — the conflict signal and the retention lifecycle are
things every integrator eventually needs and nobody wants to build. The strongest long-term
position is being the place a Solana team goes when it needs to answer "did this already happen?"
with something stronger than a log line.

**What is explicitly not the business model:** taking a cut of guarded transactions, custodying
funds, or holding value. CommitOnce writes PDAs and refunds deposits. Anything beyond that changes
the regulatory profile and would need real legal advice first.

---

## 6. Distribution plan, staged

Dates are relative to the Contest Period end (11:59pm PT 2026-10-12) and the winner announcement
(by 2026-12-05).

| Stage | Window | Goal | Concrete actions |
| --- | --- | --- | --- |
| **0 — Ship the artifact** | now → 2026-10-12 | submission is complete and every claim in it is checkable | finish the demo runner; `bash verify.sh` green; repository public and readable |
| **1 — Be installable** | Oct 2026 | a developer can adopt in one command | publish `@commitonce/solana` to npm; publish the guarded example; write the canonical rebuilt-transaction post |
| **2 — First ten conversations** | Oct–Nov 2026 | 10 recorded conversations with the profiles in §3, covering all four archetypes | sourced from public retry code, the hackathon cohort, and developer channels; each conversation documented |
| **3 — First integration** | Nov–Dec 2026 | one third-party team running the guard on a non-critical flow, in shadow mode | integration support, fingerprint review, weekly check-in |
| **4 — Trust** | Dec 2026 → | an audit, so the guard can sit in front of real value | scope the `commit-once` program and the SDK's hashing/derivation; budget it; if the budget does not exist, say so publicly rather than implying otherwise |
| **5 — Default** | 2027 | the guard appears in templates rather than in pitches | template and boilerplate PRs; relayer integration; a reference implementation for payments |

**Leading indicators to watch**, in order: repositories that clone or fork; npm installs; devnet
receipts created by someone who is not the founder; conversations completed; shadow-mode
deployments; first guarded production flow. Each of these is countable, and each will be reported
as a number or as zero.

---

## 7. What would make us stop

Stated so the plan is falsifiable rather than aspirational:

1. **Solana fixes it at the protocol level** — e.g. an intent-level deduplication mechanism in the
   runtime. This is the scenario in [`FAQ.md`](FAQ.md) "Why won't Solana just fix this?", and it is
   the honest reason the product must be more than one instruction.
2. **A maintained production protocol ships authority-scoped, RPC-free, namespace-aware
   idempotency with a retention policy.** This is the project's stated kill condition and it was
   assessed against the closest candidate in [`docs/PRIOR_ART.md`](../docs/PRIOR_ART.md) §5. If
   that changes, the assessment must be re-run and the result published.
3. **Ten conversations, no duplicate failure found in any of them.** That would mean the problem is
   real but rare in practice, which would make a dedicated primitive the wrong product shape — and
   the honest response is to say so rather than to keep selling it.
