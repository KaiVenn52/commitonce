# CommitOnce — judge FAQ

The questions a judge is most likely to ask, answered directly. **This is not the developer FAQ.**
Integration, error-code, retention and compatibility questions are answered in
[`docs/FAQ.md`](../docs/FAQ.md) (34 questions) and
[`docs/API_REFERENCE.md`](../docs/API_REFERENCE.md); this document is about the project, the
market, the business, and the limits.

One statement, made once so the rest of the document can refer to it:

> For one `(authority, namespace, idempotency key)` tuple, **no more than one guarded transaction
> may successfully commit during the receipt retention period.**

That is **at-most-once successful execution of a guarded logical intent within the configured
retention window.** It is not "exactly once", and nothing in this project describes it that way.

---

## 1. What is actually new here?

**Not the mechanism.** The receipt-PDA-abort-if-exists mechanism is old and widely deployed: Light
Protocol's `nullifier-program`, `sol_idempotent`, Helium's `lazy_transactions` block marker and
Anchor's own `init` constraint all implement it. The "prepend a small guard instruction and let
atomicity do the work" developer experience is also already deployed on mainnet. Claiming either
as an invention would be a misrepresentation, and [`docs/PRIOR_ART.md`](../docs/PRIOR_ART.md) §0
leads with that finding rather than burying it.

**What is new is the combination, and the security model is the load-bearing part:**

| | Closest prior art (Light `nullifier-program`) | CommitOnce |
| --- | --- | --- |
| Receipt seeds | `["nullifier", id]` — **the signer is not in the seeds** | authority-scoped, enforced by the program's `seeds` constraint |
| Griefing | anyone who learns or guesses an `id` can consume it and **permanently block** the legitimate intent | a third party derives a *different* address and cannot block anything |
| Dependencies | building the instruction requires an RPC round trip to fetch a validity proof | self-contained; the derivation is local and pure, no RPC, prover or indexer |
| Storage | compressed accounts and Light state trees, ~15,000 lamports, upgradeable | a plain 202-byte program-owned PDA, 1,676,400 lamports, refundable |
| Multi-tenancy | none — a single opaque 32-byte `id` | namespaces are first-class |
| Lifecycle | none — the marker is permanent | explicit retention window, dual expiry gates, permissionless cleanup, rent refund |
| Assurance | README: *"unaudited, use at your own risk"* | also unaudited — stated in [`SECURITY.md`](../SECURITY.md), the README and the security model |

The griefing point is the one worth dwelling on, because it is the difference between a safety
feature and an attack surface. An onchain guard whose address depends only on an identifier can be
front-run by anyone who learns that identifier — an order id, an invoice number, a UUID — and the
legitimate claim then fails *forever*. CommitOnce puts the authority in the PDA derivation, so the
property holds by construction rather than depending on every integrator remembering to hash their
own pubkey into the key. It is asserted by
`third_party_cannot_consume_another_authoritys_key`.

**So the honest one-line answer:** the mechanism is prior art; what is new is the productization
and the security model.

---

## 2. Why won't Solana just fix this?

It might, eventually, and if it does, that is good for the ecosystem and bad for this business.
Three reasons it has not happened yet:

1. **It is a genuine protocol design question, not an oversight.** Intent-level deduplication
   requires the runtime to know what an "intent" is. The runtime has no concept of a logical
   intent — it has messages and signatures. Adding one means defining intent identity, choosing a
   retention policy, and pricing permanent state on a network whose whole cost model is built
   around rent and state expiry. That is a substantial change, and it is not obviously the right
   place for it.
2. **Solana's own documentation assigns the remedy to the application.** The production-readiness
   guide says a rebuilt transaction has a new signature and that applications must *"preserve
   application-level idempotency before sending it."* That is an explicit handoff, not a gap
   somebody forgot to close.
3. **A protocol-level fix would still have to answer the same questions this design answers.**
   Authority scoping, namespaces, and what happens when the window ends are not incidental
   details; they are the entire design. Any runtime mechanism would face the same trade-offs,
   which is a reasonable argument that a library-shaped solution is the right layer.

**The honest risk in the other direction:** the day the runtime ships intent-level deduplication,
CommitOnce's reason to exist shrinks. That is stated as one of the project's two kill conditions
in [`GTM.md`](GTM.md) §7, and it is the reason the plan is to be more than one instruction — the
durable asset is the operational surface (receipt observability, conflict alerting, retention
lifecycle), not the `claim` instruction.

---

## 3. What happens if the receipt expires?

Expiry alone changes almost nothing, and this is the most commonly misunderstood part of the
design:

- **An expired receipt still blocks.** It is still an account, so a later claim for the same
  `(authority, namespace, key)` still finds it and still fails the transaction.
- **Expiry only makes cleanup *permitted*.** Once both deadlines have passed, `close_receipt`
  succeeds and the 1,676,400-lamport deposit is refunded to the destination recorded at claim
  time.
- **Closing ends the protection.** After the account is closed, the same tuple can be claimed
  again, and a rebuilt duplicate could then execute. This is deliberate, documented, and asserted
  by `closing_frees_the_key_for_a_new_claim` — it is the documented cost of a bounded window, not
  an oversight.

Why bound it at all: without cleanup, every receipt would be permanent, and a payments processor
issuing a million intents would lock roughly **1,676 SOL** in rent forever. Cleanup is what makes
the primitive economically usable at volume.

**What a judge should take from this:** the guarantee is *bounded*, and the product says so in its
own name for the guarantee. The rule for an integrator is one sentence: choose a retention that
exceeds your maximum retry horizon, and treat "protected" as exactly "the receipt exists".

---

## 4. How is this different from Light Protocol's nullifier program?

It is the closest thing to this project on mainnet, and it is live, permissionless, generic and
described in almost the same terms. It is not materially equivalent, for the six reasons in
question 1, of which two matter most:

**It is griefable, by design.** Seeds are `["nullifier", id]` with no signer. Anyone who can learn
or predict an `id` can claim it first and block the legitimate intent permanently. To be fair to
Light: a caller *can* hash their own pubkey into the `id` and recover the property. The claim here
is narrower — **the protocol does not enforce it**, so it is a convention each integrator must
remember, which means it is not a property the primitive can advertise.

**Its instruction cannot be built without an RPC.** The documented helper is
`create_nullifier_ix(&mut rpc, payer, id)`, which fetches a validity proof from a Light
prover/indexer first. That dependency is precisely what a guard in a retry path must not have:
the moment a retry needs a network round trip to construct the guard, the guard has inherited the
failure mode it was meant to remove. CommitOnce's `prepare()` is pure — everything is derived
locally with WebCrypto — which is what makes it usable inside a wallet, a relayer, or an offline
signer.

The other differences are state model (a plain PDA visible to any standard indexer versus
compressed state in Light's trees), namespaces, and lifecycle (no retention, no refund, permanent
state).

**A fair caveat about market reality.** Light's program has **71 crate downloads** and its npm
package was last published 2026-02-05 — roughly seven months on mainnet with negligible adoption.
CommitOnce has **zero** users. A judge is entitled to read that as evidence that this category is
hard to sell, and [`TRACTION.md`](TRACTION.md) §3 says exactly that rather than spinning it.

---

## 5. How is this different from a durable nonce?

They solve different problems, and the interaction between them is why the program has an explicit
policy about it.

**A durable nonce makes a *signed transaction* stay valid indefinitely.** It says nothing about
the identity of an *intent*. To retry with a nonce you must re-sign against the current nonce
value, which produces a different transaction, and the network has no way to connect the two. So a
nonce extends the life of one transport artifact; it does not answer "has this intent already
happened?"

**They interact badly, so the program refuses the unsafe combination.** A durable-nonce
transaction never expires, so an old signed duplicate stays executable *forever*. If its receipt
could be cleaned up, cleanup would reopen the duplicate window permanently. So `claim` inspects
the Instructions sysvar for a System Program `AdvanceNonceAccount` instruction and rejects the
transaction with `DurableNonceUnsupported` (6002) **unless retention is `0` (permanent)**.
Permanent receipts have no cleanup path, so they are safe with nonces and are explicitly
supported.

**An honest limitation:** a genuine durable-nonce transaction cannot be constructed in LiteSVM
0.10.0, because LiteSVM passes the transaction's own blockhash into the program environment,
making the System Program's advance check and the runtime's nonce validation mutually exclusive.
The tests assert the program's deliberately stricter behaviour — the *presence* of the marker
triggers the policy, in both directions — and the limitation is documented at length in
`programs/commit-once/tests/security.rs` and in [`EVIDENCE.md`](../EVIDENCE.md) §7.

---

## 6. What is the business model?

**Open core, and the core stays free.** The program, the SDK and the derivation are Apache-2.0 and
free forever. Charging for the ability to not double-spend is charging for safety, which suppresses
exactly the adoption a primitive needs. There is **no revenue today** and none is claimed.

Revenue, if the primitive is adopted, comes from the operational surface around it:

| Line | What it is | Who pays |
| --- | --- | --- |
| Receipt observability | A read API and alerting over receipt state — which intents committed, which are near expiry, and which keys are held by a *conflicting* payload. The conflict alert is the feature: it means a real action was about to be silently dropped. | Teams running the guard in production |
| Cleanup automation | A keeper that closes expired receipts and reclaims rent, with monitoring | High-volume issuers holding many live receipts |
| Support and production readiness | Integration review, fingerprint design review, help preparing for an audit | Teams putting the guard in front of real value |
| Managed or self-hosted index | The same read API, deployed in the customer's infrastructure | Regulated or security-sensitive teams |

**What is explicitly not the model:** taking a cut of guarded transactions, custodying funds, or
holding value. CommitOnce writes PDAs and refunds deposits. Anything beyond that changes the
regulatory profile and would need real legal advice first — see
[`NEEDS_OWNER_ACTION.md`](../NEEDS_OWNER_ACTION.md) §7.

**A judge should notice the honest weakness:** this is a business model for a category that has
not yet been proven to have buyers. The plan to test that is in [`TRACTION.md`](TRACTION.md) §4,
and it is designed to fail visibly if the demand is not there.

---

## 7. Why is this a company and not a feature?

Because a primitive that sits in front of money movement has to be maintained, audited and
supported for years, and that work has to be paid for.

The code is Apache-2.0 either way, so it is a public good regardless of what happens commercially.
The company exists for the parts a public good has no maintenance path for:

1. **Someone has to answer "is this still safe to use in production?"** after I stop being the
   only person who has read the code. That means an audit, and then keeping it current.
2. **Retention has a lifecycle.** Receipts accumulate, deposits are held, keys expire, keepers
   have to run. Every integrator eventually needs this and nobody wants to build it.
3. **Conflicts are operational events.** When a key is reused for a different payload, a real
   action is about to be dropped. Somebody has to be alerted, and that somebody needs a product,
   not a log line.
4. **Trust is a service, not a one-time artifact.** For infrastructure, "who maintains this and
   what is their incentive" is part of the security model.

**The counter-argument, stated fairly:** one instruction is a small surface, and a judge could
reasonably say this is a library, not a company. The response is that the instruction is the wedge
and the lifecycle around it is the product — but that is a claim about the future, not a fact about
today, and it is marked as such.

---

## 8. What stops a larger player from copying it?

**Nothing, mechanically.** The code is Apache-2.0, the mechanism is prior art, and a competent
team could reimplement `claim` in a week. If the answer were "our moat is the code", the answer
would be wrong.

What actually protects the position, in order of strength:

1. **The hard part is not the code, it is being trusted.** A guard in front of a payment needs an
   audit, a security model, published limitations, reproducible evidence and a maintenance
   commitment. That is slow, unglamorous work that a larger player has no incentive to do for a
   category with no proven buyers — which is precisely the window this project exists in.
2. **Being early and correct on the security model.** Authority-scoped seeds, no prover
   dependency, namespaces, and a retention policy with dual expiry gates are design decisions that
   are hard to retrofit onto a shipped primitive, because they change the derivation — and changing
   the derivation invalidates every existing receipt.
3. **Distribution through defaults.** The durable advantage is being in the templates,
   boilerplates and relayer paths that teams start from, so the guard is the default rather than a
   decision.
4. **The operational surface.** Observability, alerting and cleanup are where a real customer
   relationship forms, and they are stickier than an instruction.

**The realistic risk is not being copied — it is being ignored.** A larger player's most likely
move is to build intent deduplication into their own stack for their own customers and never
productize it. That is covered as risk 3 in question 9.

---

## 9. What is the single biggest risk?

**That the problem is real but does not hurt enough for developers to add a dependency.**

It is the honest one, and it is uncomfortable because the evidence cuts both ways. In favour of
the thesis: Solana documents the gap itself, every transaction-delivery vendor tells clients to
handle retries in their own code, and the failure mode is silent double execution of a money
movement. Against it: the closest deployed primitive has been live on mainnet for about seven
months with 71 crate downloads and effectively no adoption.

Adoption cost is the mechanism by which that risk would materialise. Integrating CommitOnce
requires one dependency and one discipline — *put semantic fields in the fingerprint, never
transport details* — and if that discipline is applied wrongly, a rebuilt retry is reported as
`IdempotencyConflict` instead of `AlreadyCommitted`, which is a worse outcome than not using the
guard at all. That footgun is documented prominently (it is the answer to "what is the single
biggest way an integrator can weaken the guarantee?" in [`docs/FAQ.md`](../docs/FAQ.md)), and the
mitigation is the shadow-mode stage in [`TRACTION.md`](TRACTION.md) §4, which is designed to catch
it on a non-critical flow.

**Runners-up, stated because a single-risk answer is usually a dodge:**

- **Solana fixes it in the runtime** (question 2) — good for the ecosystem, bad for this business.
- **Light Protocol or another team ships authority-scoped, RPC-free idempotency with retention** —
  the project's stated kill condition, assessed as not triggered in
  [`docs/PRIOR_ART.md`](../docs/PRIOR_ART.md) §5.
- **A bug in an unaudited program.** The program is unaudited, and a defect in a guard that sits
  in front of payments would be worse than no guard. This is why nothing should be put in front of
  real value before an audit, and why [`TRACTION.md`](TRACTION.md) §4 gates production use on it.

---

## 10. What have you not verified?

This is the question that decides whether the rest of the submission is believable, so it gets the
longest answer. The full list is [`EVIDENCE.md`](../EVIDENCE.md) §7.

| Claim | Status |
| --- | --- |
| **Mainnet deployment** | **Not done.** No mainnet keypair or funding exists. |
| **Security audit** | **Not done.** The program is unaudited. |
| **npm publication** | **Not done.** `@commitonce/solana` is not published. |
| **Third-party integration** | **None.** No external project uses CommitOnce. |
| **Real users, revenue, waitlist** | **None.** |
| **Traction of any kind** | **None.** |
| Transaction v1 messages | **Not tested.** v1 is live on mainnet as of epoch 1035 and does not change message-hash deduplication, but the SDK and tests exercise legacy and v0 messages only. |
| Address lookup tables / v0 execution | **Tested end-to-end** in `tests/versioned.rs`. The guard commits when the receipt PDA, the Instructions sysvar, the System Program and the business program all arrive through a lookup table; a rebuilt v0 retry is blocked with `AlreadyCommitted` and the counter stays at 1; and a signer listed in a table is not loaded from it. Previously "constructing was checked, executing was not" — now it executes. |
| Non-Anchor callers | **Not tested.** The SDK hand-encodes the wire format, so a non-Anchor client can call the program, but no such client has been written or run. |
| Genuine durable-nonce transactions | **Cannot be tested in LiteSVM 0.10.0** — see question 5. |
| SBPFv3 build | **Not verified**, and deliberately not shipped, because LiteSVM cannot verify it. |
| Compute units on mainnet | **Not measured.** And the harness does not match the runtime: devnet reported `claim` at 14,669 CU against the harness's 9,283 median, so the in-process numbers are a lower bound. Budget from the devnet figure. |
| Simultaneous duplicate submissions | **Exercised, in two places.** In-process, `only_the_first_of_many_attempts_commits` builds five distinct valid attempts against one blockhash and asserts exactly one commits. Live, `apps/demo/concurrent-claim.ts` fires 5–8 competing transactions at real devnet validators with the same result — exactly one commits, the rest fail `AlreadyCommitted` onchain. Caveat: the live runs spread over 2–3 slots, because a client cannot force a leader to pack its transactions together, so the same-slot case rests on the in-process test. |
| A live devnet A/B demo run | **Done.** `apps/demo/commitonce-demo.ts` was executed against the deployed devnet programs on 2026-09-21; the raw output is in [`evidence/devnet-demo-run.log`](evidence/devnet-demo-run.log). A live contention run is in [`evidence/devnet-contention-run.log`](evidence/devnet-contention-run.log). |
| **Composability with other programs** | **Executed, not just reasoned about.** Three of the four examples have run against devnet against the deployed program: `sol-transfer` (System Program), `spl-transfer` (SPL Token + Associated Token in one atomic transaction), `custom-program` (an arbitrary Anchor program, where the retry carried a *different* instruction set from the first attempt and was still blocked). Raw output in [`evidence/`](evidence/). The Jupiter-swap example is **structural** — it needs Jupiter's live API and has never submitted a transaction. |

**Also not claimed, anywhere:** that the mechanism is novel, that the program is production-ready,
that it is safe for mainnet, that it has been reviewed by anyone other than its author, or that
"exactly once" describes it.

---

## 11. How big is the market, honestly?

**Small in headcount, large in leverage, and I am not going to invent a dollar figure.**

The addressable set today is the subset of Solana engineering teams with a transaction-critical
retry path: payments and checkout, trading bots, game and mint backends, relayers, agent
frameworks, and wallets with a retry button. In absolute terms that is likely a few thousand teams
at most — a small number, and a judge should treat any large TAM figure for a developer primitive
as a warning sign.

The leverage argument is the real one: **each integration guards every transaction on that path**,
so a handful of integrations in payments or relayers covers a very large number of intents. That
is also the honest reason the first ten users matter more than the ten-thousandth: one relayer
integration reaches every application behind it.

The market-size question is genuinely hard to answer from the bottom up without customer
conversations, which is exactly why [`TRACTION.md`](TRACTION.md) §4 spends its effort on ten
conversations rather than on a spreadsheet.

---

## 12. Why should a judge believe the numbers?

Because none of them require trust, and the ones that are weakest are labelled.

- The devnet deployment is checkable with one command against a public cluster, and the deploy
  signature is on a public explorer.
- The test counts are produced by running the suite. The tests execute the **real compiled SBF
  artifact** through LiteSVM, not a mock or a reimplementation, and they assert on observable
  onchain state rather than on error strings.
- The overhead figures come from a benchmark test that prints them, and the provenance of each
  number is stated: compute units and the deposit are *measured*; the transaction wire size is
  *computed* from the legacy message format with the formula written out, because LiteSVM does not
  report serialized size.
- The rent figure was not taken from a crate constant — it was read out of the live mainnet Rent
  sysvar, cross-checked with `solana rent 202` on two clusters, and confirmed by the harness. This
  mattered, because the `solana-rent` crate still ships a stale constant that would have overstated
  the deposit by **37%**.
- The prior-art survey quotes primary sources, and its first section argues against the project's
  own novelty claim.
- [`EVIDENCE.md`](../EVIDENCE.md) §7 lists what is not verified, and
  [`TRACTION.md`](TRACTION.md) opens with a table of zeros.

A submission that documents its own gaps is easier to check than one that does not, and that is the
only reason to read any of it charitably.

---

## 13. What happens after the deadline?

The plan, with dates and thresholds, is in [`GTM.md`](GTM.md) §6. In order: publish the SDK to npm;
complete ten documented conversations across the four archetypes; get one team into shadow mode,
which produces the number that actually matters — *"N retries, M of which would have
double-executed without the guard"*; then audit before anything holds real value. If the audit
budget does not exist, the correct action is to say so publicly rather than imply otherwise.

The kill conditions are written down in advance: the project stops if the runtime ships intent-level
deduplication, if a maintained protocol ships authority-scoped RPC-free idempotency with retention,
or if ten conversations find no duplicate failure at all. That last one would mean the problem is
real but rare, and the honest response would be to say so and re-scope to detection rather than
keep selling prevention.
