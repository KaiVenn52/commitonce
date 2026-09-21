# Prior art and competitive boundary

**Retrieved and verified 2026-09-19.** Every load-bearing claim below is either quoted from
a primary source (official docs, official repository source, or on-chain state) or marked
UNVERIFIED. Secondary blog posts were not used as evidence. The full unedited research
trail, including per-target source lists and the master candidate table, is preserved at
[`docs/research/prior-art-landscape-raw.md`](research/prior-art-landscape-raw.md).

---

## 0. Headline finding — read this first

**CommitOnce is not novel in mechanism, and the "prepend a guard instruction" developer
experience is not novel either.** Both are deployed prior art on Solana mainnet today.

Specifically, **Light Protocol's `nullifier-program`**
(`NFLx5WGPrTHHvdRNsidcrNcLxRruMC92E4yv7zhZBoT`) already implements a generic,
permissionless, composable, rebuild-robust onchain "execute this at most once" guard that
you prepend to your own transaction. Its official documentation describes the use case in
almost exactly CommitOnce's terms.

**This does not make the projects materially equivalent, and it does not trigger our kill
condition** — but it does mean the honest framing of CommitOnce is *productization and
security model*, not *invention*. The differences are enumerated and evidenced in §4. The
two that matter most are that Light's key is **griefable** (the authority is not part of
the receipt derivation, so anyone can consume your key first and permanently block you)
and that building its instruction **requires an RPC round trip** to fetch a validity
proof, which is precisely the dependency CommitOnce exists to avoid.

Everything downstream — the website copy, the pitch, the README — must be consistent with
this section. Where this document says "we do not claim X", that is a constraint, not a
suggestion.

---

## 1. Baseline: what Solana itself deduplicates

This is the premise the whole product rests on, so it is stated precisely — and precisely
is where an earlier draft of this document got it wrong, so the correction is recorded here.

**The runtime keys its deduplication on the message hash, not on the signature.** Agave's
`runtime/src/bank.rs` says so verbatim:

> *"add the message hash to the status cache to ensure that this message won't be processed
> again with a different signature"*

The distinction matters because it is easy to describe the mechanism as
signature-based — a signature is derived from the message, so for byte-identical
transactions the two framings coincide and the error is invisible. They diverge exactly
where the product lives: a rebuilt transaction has a different message, hence a different
message hash, hence no deduplication. A signature-based description would imply the runtime
tracks something the message cannot change, which is the opposite of the truth.

So the protection is **content-addressed**: it protects *signed bytes*.

It does **not** protect a *logical intent*. A rebuilt transaction — fresh blockhash,
different priority fee, different route, different account order, different compute budget —
is different bytes, has a different message hash, and is a completely different object to
the runtime. Both can land. That is the failure this project addresses.

### Solana documents this gap itself

This is the single most important primary source for the project, because it establishes
that the problem is officially acknowledged rather than invented by us. From
<https://solana.com/docs/tools/production-readiness>:

> *"A rebuilt transaction has a new signature, so preserve application-level idempotency
> before sending it."*

The same page adds that *"a `null` result from the recent signature-status cache is
inconclusive"* — so even *asking* whether the first attempt landed is not reliable. The
official guidance therefore names both halves of the problem (the duplicate risk and the
inconclusive check) and then assigns the remedy to the application. That assignment is the
gap CommitOnce fills.

The scope and lifetime of the status-cache protection beyond this are **UNVERIFIED in exact
detail** from primary sources — the precise retention window and its behaviour across ledger
boundaries is not documented as a stable contract. The operative point does not depend on
it: after a blockhash expires, a rebuilt transaction is a new transaction, and no amount of
runtime deduplication will connect it to its predecessor.

A related primary source reinforces the same conclusion from the opposite direction. SDP's
`Idempotency-Key` specification includes `transactionId` in its request fingerprint — an
admission, in the spec itself, that an HTTP idempotency key keyed on a transaction
identifier cannot deduplicate a transaction that was rebuilt into a different one.

---

## 2. Products that operate at other layers (not competitors, but must be understood)

For each: what it solves, its layer, what it actually protects, and why CommitOnce is
different.

### 2.1 Solana Developer Platform HTTP `Idempotency-Key`

- **What it solves:** duplicate *backend API requests* against the Foundation's
  tokenization/payments/compliance platform.
- **Layer:** backend REST API + Postgres + dashboard. **Zero onchain program** — a
  full-tree scan of `solana-foundation/solana-developer-platform` finds no Rust.
- **What it protects:** HTTP mutation requests, via a unique index on
  `(organization_id, project_id, idempotency_key)`. A replay returns the live record
  (HTTP 200); the same key with a different payload returns 409.
- **Difference:** it is not permissionless (requires a Bearer key), not generic, not
  composable, and it protects nothing about onchain execution.

**The single most useful fact found in this entire investigation** is that SDP's own
`lib/idempotency.ts` deliberately includes `transactionId` in the request fingerprint
*because a key retried against a rebuilt transaction is a different request and must 409*.
That is the Solana Foundation's own primary-source admission that HTTP idempotency keys
**do not** solve the rebuilt-transaction problem. It is the cleanest available evidence
that this problem is real and unsolved at the API layer.

### 2.2 Solana Pay `reference` keys

- **What it solves:** locating a payment onchain.
- **Layer:** client SDK convention; a read-only non-signer account key.
- **What it protects:** nothing. The canonical spec states verbatim that *"The values may or
  may not be unique to the payment request."* There is no uniqueness requirement, no
  onchain check, and no abort.
- **Difference:** it is a client-side identifier for lookup, not a uniqueness constraint.
  It cannot prevent a duplicate because it never rejects anything.

### 2.3 Helius Sender

- **What it solves:** transaction delivery / landing rate.
- **Layer:** RPC/relay.
- **What it protects:** nothing, by design. Helius documents that `sendTransaction` *"does
  not alter the transaction in any way; it relays the transaction created by clients to the
  node as-is."* The only checks are economic (tip and priority-fee minimums). Helius
  explicitly warns that re-signing with the same blockhash *"can lead to duplicate
  transactions being confirmed"* — it documents the hazard rather than preventing it, and
  delegates retries to the caller.
- **Difference:** complementary, not competitive. CommitOnce is exactly the layer Helius is
  telling you to build yourself.

### 2.4 Jito bundles

- **What it solves:** atomic multi-transaction inclusion and MEV protection.
- **Layer:** block-engine / validator.
- **What it protects:** **atomicity, which is not deduplication.** Bundles are
  all-or-nothing; there is no idempotency key. The only dedup-adjacent mechanism is
  `DroppedReason.PartiallyProcessed` in `bundle.proto` — a *post-hoc reaction* to Solana's
  `AlreadyProcessed`, not a pre-submission guard.
- **Difference:** Jito guarantees "all or none of these land together". CommitOnce
  guarantees "this intent lands at most once". Orthogonal.

### 2.5 Triton One (Cascade / Yellowstone)

- **What it solves:** transaction delivery and streaming.
- **Layer:** RPC/relay and gRPC streaming.
- **What it protects:** nothing at the intent layer. There is no "Triton Sender" product;
  the equivalent is Cascade, which tells you to *"Handle retries in your own code… set
  `maxRetries: 0`."* Dragon's Mouth delivers **at-least-once** and instructs clients to
  deduplicate themselves.
- **Difference:** same story as Helius — the vendor explicitly pushes this problem to the
  caller.

### 2.6 Squads `nonce-guard`

- **What it actually is:** the name is misleading. `Squads-Protocol/nonce-guard`
  (`guardgkc38afzaHQ7LNAtWHKgdUAAwyayhNdY8MPNnw`, v0.1.0, MIT, includes an OtterSec audit)
  is a PDA proxy-signer whose defining behaviour is to **reject durable-nonce
  transactions**.
- **What it protects:** it deduplicates **nothing** — no key, no receipt, no seen-set, no
  retention. Its PDA is `["guarded_proxy", owner]`, per-owner, not per-intent.
- **Relevance to CommitOnce:** it is the *conceptual* prior art for our durable-nonce
  rejection (§ "durable nonce policy" in the security model). It is one line:
  `ensure_never_nonce(instructions_sysvar, DurableNonceBlocked)` inspecting the instructions
  sysvar. We implement our own version of that idea and cite it as such; we do not vendor
  or copy their code.

### 2.7 Helium `lazy_transactions`

- **What it solves:** scheduled/cranked execution of pre-committed transaction batches, used
  for the HNT L1→Solana migration.
- **Layer:** onchain program (`helium-program-library`).
- **What it protects:** genuinely **at-most-once execution of a pre-committed Merkle leaf,
  robust to rebuild** — a bitmap check plus a legacy empty `Block` PDA documented as *"Empty
  account that blocks tx from going through more than once."* This is the strongest
  execute-once implementation found in production Solana code.
- **Difference — and this is the decisive one:** **you cannot prepend it to an arbitrary
  transaction.** Your business instructions must be *pre-committed into an authority-owned
  Merkle tree*; `execute_transaction_v0` verifies a proof against the stored root. The key
  is a `u32` leaf index fixed at commit time, not a caller-chosen
  `(authority, namespace, idempotency key)`. It is authority-gated, has no retention window,
  and its key space must be pre-provisioned via `max_depth`. It is a crank engine, not a
  general idempotency primitive.

---

## 3. The one materially overlapping artifact: Light Protocol `nullifier-program`

This section exists because it is the honest answer to "has someone already built this?"

**Program ID:** `NFLx5WGPrTHHvdRNsidcrNcLxRruMC92E4yv7zhZBoT`
**Docs:** <https://www.zkcompression.com/compressed-pdas/nullifier-pda>
**Source:** <https://github.com/Lightprotocol/nullifier-program>

**Independently verified in this session, by us, two ways:**

1. **On-chain state.** Direct `getAccountInfo` JSON-RPC calls returned
   `executable=True`, `owner=BPFLoaderUpgradeab1e11111111111111111111111`, `space=36` on
   **both** `api.mainnet-beta.solana.com` and `api.devnet.solana.com`. It is live and
   upgradeable on both networks.
2. **Primary documentation**, fetched directly. Verbatim: *"For some use cases, such as
   sending payments, you might want to **prevent your on chain instruction from being
   executed more than once**… The nullifier program utility solves this for you. It derives
   PDA from `["nullifier", id]` seeds (where `id` is your unique identifier, e.g. a nonce,
   uuid, hash of signature, etc.). Creates an empty rent-free PDA at that address. **If the
   address exists, the whole transaction fails.** **Prepend or append this instruction to
   your transaction.**"* The same page states: *"Note that this is a reference
   implementation. Feel free to fork the program as you see fit."*

The mechanism is the same invariant CommitOnce implements: a deterministic receipt PDA in
the same atomic transaction, aborting the whole transaction if it already exists, robust to
a rebuilt transaction because the receipt is onchain state rather than signature-derived.

### The six material differences

These are the actual competitive surface. Each is a concrete, checkable property.

| # | Difference | Evidence |
| --- | --- | --- |
| 1 | **No authority scoping → griefable.** Seeds are `["nullifier", id]`; **the signer is not in the seeds.** Anyone who learns or predicts an `id` can consume it first and *permanently* block the legitimate intent. | Primary doc (seeds quoted above); source `derive_address(&[b"nullifier", &id], &address_tree_pubkey, &crate::ID)` |
| 2 | **Requires an RPC.** Building the instruction means fetching a Light validity proof from a prover/indexer first — the documented helper is `create_nullifier_ix(&mut rpc, payer, id)`, and the example constructs a `LightClient` with an explicit RPC URL and API key. | Primary doc code samples |
| 3 | **Compressed-account dependency.** ~15,000 lamports of Light state-tree-backed compressed state requiring `ValidityProof`, `address_tree_info`, `output_state_tree_index` and remaining accounts for a Light System Program CPI — not a plain rent-exempt program-owned PDA visible to any standard indexer. | Primary doc |
| 4 | **No namespace.** A single opaque 32-byte `id`; multi-tenancy and per-app key spaces are entirely the caller's responsibility, so two applications cannot safely use the same textual key. | Primary doc |
| 5 | **Explicitly unaudited.** README verbatim: *"The nullifier program code is unaudited, use at your own risk."* | Repo README |
| 6 | **Negligible adoption and continuity risk.** 71 crate downloads; npm `0.1.3` last published 2026-02-05; live on mainnet roughly seven months with effectively no traction, no product surface, no retention policy. Light's own docs carry a *"Light is joining Helius"* banner. | Registry data; docs banner |

**A note on #1, because it is the difference we lean on hardest.** We are not claiming
Light's design is *wrong* — a caller can hash their own pubkey into `id` and recover the
property. We are claiming the *protocol does not enforce it*. CommitOnce puts the authority
in the PDA derivation, so the property holds by construction and cannot be forgotten by a
developer. That is a real difference in security model, and it is exactly the kind of thing
this project should be judged on.

**Second, weaker instance:** `sol_idempotent`
(`id7Fj1ywco2RdzTCQFNcYxf6Wu9iJZeNPtQY9xdsw87`, also RPC-verified `executable=True` on
mainnet). Same invariant, but keyed by a bare `u32` bit index in an owner-scoped bitmap,
with no PDA derivation, a single mutable account per map (contention hotspot), a
pre-provisioned fixed key space, and **abandoned since 2023-04-21** (Anchor 0.24.2).

---

## 4. What is prior art and what is not

This distinction governs every public claim we make.

### Established prior art — we must NOT claim these

- **The receipt-PDA-abort-if-exists mechanism.** Light's nullifier program, `sol_idempotent`,
  Helium's `Block` marker, and Anchor's own `init` constraint all implement it.
- **The `(authority, resource_id) → PDA → create-or-fail` idiom.** This is the *de facto*
  Solana replay-guard idiom, expressed as Anchor's `init` (create-or-fail) versus
  `init_if_needed` (upsert, which defeats the guard). The ecosystem's standing warning
  against `init_if_needed` is itself evidence the idiom is understood as a replay guard.
  Primary source: `comprido96/solana-reward-claim` README — *"Each claim creates a
  `claim_record` PDA seeded by `(player, reward_id)` with Anchor's `init`… A duplicate claim
  fails on 'account already in use.' The `(player, reward_id)` pair is the replay nonce."*
- **"Prepend a tiny generic guard program to your transaction and let atomicity do the
  work."** This UX shape is deployed: `solana-asm/shield` ships seven guard programs and
  states *"You stick the check in front of your real action in the same transaction."*
  `p-never-nonce` (`pnn1ctaR1tbP7EGrcz3WtrJKknRxKmKqADztKY9C3YJ`, also RPC-verified
  executable on mainnet by us) is generic, permissionless, CPI-able, and reproducibly
  built. **Every deployed instance of this pattern is stateless** (deadlines, slippage,
  allowlists) — none of them remembers anything between transactions, which is exactly the
  gap a receipt fills.

### Not prior art — what is genuinely absent

- **Authority-scoped receipt derivation enforced by the protocol.** No existing generic
  primitive binds the authority into the receipt address, so no existing generic primitive
  is immune to third-party key consumption by construction.
- **A self-contained guard with no RPC, prover, or indexer dependency.** Every generic
  candidate either needs a proof fetch (Light) or is not generic.
- **Namespaces as a first-class concept**, so two applications can use the same textual
  idempotency key without colliding.
- **An explicit retention window with expiry-gated permissionless cleanup and rent refund**,
  plus a documented durable-nonce policy that makes the window safe.
- **A productized primitive**: versioned program, typed SDK, documented security model,
  honest limitations, observability of live receipts, and reproducible evidence.

### Market reality

The market is empty of **products**, not of **mechanisms**. Registry searches found no
shipped Solana onchain idempotency primitive on crates.io or npm; GitHub repository search
for `solana+nonce+manager`, `solana+guard+instruction+program`,
`solana+idempotency+program+anchor`, `solana+at-most-once`, and
`solana+exactly+once+execution` all return **zero** relevant results. `solana.com/docs` and
`/developers` never mention idempotency, and none of roughly 130 SIMDs proposes it.

---

## 5. Kill-condition assessment

Our stated kill condition is: *"A currently maintained production protocol already provides
materially identical generic functionality."*

**Assessment: not triggered.** The overlap is real but not materially equivalent:

1. Light's primitive is explicitly *"a reference implementation"*, explicitly *"unaudited"*,
   and has ~71 crate downloads and no product surface. It is not a *maintained production
   product*.
2. It differs materially in security model (#1 — protocol-enforced authority scoping),
   architecture (#2 — RPC proof dependency), state model (#3), multi-tenancy (#4), and
   assurance (#5).
3. It has no retention semantics at all, so it cannot offer a bounded guarantee, cannot
   return rent, and leaves permanent state.

We therefore continue, with corrected positioning. **We will not claim that no one has built
this, and we will not claim the mechanism or the guard-instruction UX as novel.** We claim
the productized, authority-scoped, RPC-independent, namespace-aware, retention-windowed
primitive with a documented security model.

If Light ships authority-scoped seeds, an RPC-free instruction builder, namespaces, and a
retention policy, this assessment changes and should be re-run.

---

## 6. Verification log

Everything we relied on, and how it was checked.

| Claim | How verified | Result |
| --- | --- | --- |
| `NFLx5WGPrTHHvdRNsidcrNcLxRruMC92E4yv7zhZBoT` is live | `getAccountInfo` on mainnet-beta and devnet | `executable=True`, `owner=BPFLoaderUpgradeab1e…` on both |
| Light nullifier seeds are `["nullifier", id]` with no signer | Primary doc fetched directly; quoted verbatim in §3 | Confirmed |
| Light's instruction build requires an RPC proof fetch | Primary doc code samples (`create_nullifier_ix(rpc, …)`, `fetch_proof`) | Confirmed |
| Light calls itself an unaudited reference implementation | Primary doc + repo README | Confirmed |
| `pnn1ctaR1tbP7EGrcz3WtrJKknRxKmKqADztKY9C3YJ` is live | `getAccountInfo` on mainnet-beta | `executable=True` |
| SDP's `Idempotency-Key` is backend-only with no onchain program | Repo tree scan; `lib/idempotency.ts` read | Confirmed |
| Solana Pay `reference` values need not be unique | Canonical spec text | Confirmed |
| Helius Sender relays as-is and delegates retries | Official docs | Confirmed |
| Squads `nonce-guard` rejects durable nonces and dedupes nothing | Repo source read | Confirmed |
| Helium `lazy_transactions` requires pre-committed Merkle leaves | Repo source read | Confirmed |
| No onchain Solana idempotency primitive on crates.io/npm | Registry searches | Confirmed (zero results) |

### Explicitly UNVERIFIED

- The exact retention window and cross-boundary behaviour of Solana's status-cache
  deduplication as a *documented contract*.
- Whether a Light system-level `close`/`reinit` could un-spend a nullifier, i.e. whether
  Light's marker is truly permanent. Its program exposes no close path, so it is permanent
  in practice.
- GitHub **code** search (requires authentication) — only repository/name search was
  available. A primitive could exist inside a private or low-signal repository.
- Colosseum's prior-project archive is a client-rendered SPA with no public API, so it could
  not be searched exhaustively for a prior hackathon project in this space.
- EVM/other-chain landscape was surveyed but not exhaustively enumerated.
