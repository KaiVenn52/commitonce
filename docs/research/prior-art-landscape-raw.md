# CommitOnce — Competitive & Prior-Art Landscape

**Research date:** September 2026
**Subject:** Does a generic, permissionless, composable **onchain idempotency-key primitive** already exist for Solana?

**Method / evidence policy.** Primary sources only: official documentation sites, official GitHub repositories (READMEs *and* actual program source, read from clones rather than summaries), official package registries (crates.io, npm), and live Solana JSON-RPC `getAccountInfo` calls to confirm real onchain deployment. No marketing listicles or AI-generated blog content was used for any claim. Anything not confirmable from a primary source is marked **UNVERIFIED**.

**Tooling caveats, stated plainly:**
- GitHub **code** search requires authentication and was unavailable. Only **repository** search was usable. So "no repo implements X" is supported by repo-name/description search plus registry search, not by exhaustive code grep. Marked **UNVERIFIED** where it matters.
- **Colosseum's hackathon archive** is a client-rendered SPA with no reachable public JSON API (its Copilot requires a token), and `colosseum.org` / `arena.colosseum.org` returned 308 redirects to a non-fetchable surface. Colosseum coverage is therefore **UNVERIFIED** — not searched exhaustively.
- No `web_search` tool was available in this session. Direct HTTP fetching plus registry APIs were used instead. Bing returned degraded, query-ignoring results; Brave worked but rate-limited; DuckDuckGo/Mojeek/Startpage/Yandex/Ecosia were JS-gated or 403. This is why the report leans on registries and repos rather than search-engine discovery.

---

## Baseline: what Solana itself deduplicates (needed to read every section below)

| Mechanism | What it keys on | Robust to a rebuilt tx? |
|---|---|---|
| **Status cache / `AlreadyProcessed`** | The transaction **message hash**, which covers the blockhash | **NO.** A rebuilt tx has a new blockhash → new message hash → passes. Also validator-side, not composable, leaves no onchain receipt. |
| **`TransactionError::AlreadyProcessed`** | Same | "The bank has seen this transaction before… or as a double-spend attack" — [docs.rs](https://docs.rs/solana-transaction-error/latest/solana_transaction_error/enum.TransactionError.html) |
| **Durable nonces** | A monotonic nonce value on a System-Program nonce account | **Partial.** Survives blockhash expiry (its actual purpose), but advance-and-resign is a fresh valid tx. Docs note: "Durable nonces may be deprecated in a future release." |

Sources: https://solana.com/docs/core/transactions/transaction-pipeline · https://solana.com/docs/core/transactions/durable-nonces

**This is precisely the gap CommitOnce targets, and it is a real gap.** Every system surveyed below inherits *only* this signature/message-hash dedup and adds nothing above it.

---

## 1. Solana Developer Platform (SDP) and its HTTP `Idempotency-Key` header

**Official repo:** https://github.com/solana-foundation/solana-developer-platform (`solana-foundation/solana-developer-platform`, created 2026-01-28, MIT, homepage https://platform.solana.com)
**Official docs:** https://platform.solana.com/docs
**Doc page read:** `apps/sdp-docs/content/docs/developing-with-sdp/idempotency.mdx`
**Middleware read:** `apps/sdp-api/src/middleware/idempotency-key.ts`
**Resolver read:** `apps/sdp-api/src/lib/idempotency.ts`
**Migration read:** `apps/sdp-api/src/db/migrations/postgres/0025_payment_transfer_idempotency.sql`

**(a) Problem it solves.** SDP is *not* developer transaction infrastructure in the CommitOnce sense. It is a **dashboard + REST API for tokenization, custody, payments, embedded yield, and compliance** on Solana — the Foundation's financial-product platform (stablecoin issuance, onramp/offramp, batch payroll, custody wallets with signing policies). Its `Idempotency-Key` header exists so that a client which times out can safely retry a **money-movement mutation** against the API.

**(b) Layer.** Backend REST API + Postgres, plus a Next.js dashboard. Explicitly **no onchain program**: a full-tree scan for `Cargo.toml` / `*.rs` / `programs/` found only generated TypeScript clients for third-party programs — zero Rust, zero onchain component. This is a **backend API**, full stop.

**(c) What it precisely deduplicates.** **Backend HTTP mutation requests**, keyed by a caller-minted opaque string, backed by a **unique index in Postgres**:

```sql
ALTER TABLE payment_transfers
  ADD COLUMN idempotency_key TEXT,
  ADD COLUMN idempotency_fingerprint TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transfers_org_project_idempotency_key
  ON payment_transfers(organization_id, COALESCE(project_id, ''), idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

Semantics, verbatim from the official doc:
- The key is *"claimed by the **business record itself**, not by a snapshot of the original response."*
- Replay with same key + same payload → **HTTP 200 with the live stored record** (so a transfer that has since finalized returns `finalized`, not the original `processing`).
- Same key + **different payload** → **409 `CONFLICT`** ("Idempotency key already used with different request payload").
- *"Keys are retained for the lifetime of the record they claimed — there is no TTL."*
- Header validated on every `/v1` route (1–255 printable ASCII) but **only consumed by specific endpoints**; *"Elsewhere it is accepted and ignored."*
- Namespaces: **per project** (payments transfers, transfer-batches), **per organization** (all issuance ops), and required on custody provider-credential submission.

**It covers onchain execution only indirectly and not at all as a primitive.** It dedupes *SDP's own business records*. If you use SDP's API to move funds, you get at-most-once for that API call. If you build your own transaction, it does nothing. It is not composable with arbitrary instruction sets.

**The single most telling detail — and the strongest evidence for CommitOnce's premise.** SDP's fingerprint builder explicitly includes `transactionId` for external-wallet submits, with this comment in `lib/idempotency.ts`:

> *"`transactionId` earns its place because the submit names one specific built transaction: two builds are two distinct signable transactions, so **a key retried against a REBUILT transaction is a different request and must 409** rather than silently answer with the first build's movement."*

**SDP's own maintainers state that a rebuilt transaction is a *different* request under their idempotency model.** They chose 409 over intent-recognition. This is a direct, primary-source admission that HTTP-layer idempotency keys do **not** solve the rebuilt-transaction problem — exactly the problem CommitOnce claims to solve.

**(d) Permissionless/generic?** **No.** It is a proprietary, authenticated (`Authorization: Bearer sk_test_…`), account-scoped REST API. Not permissionless, not generic, not composable.

**(e) Maintenance.** Actively developed. HEAD `9afd520` dated **2026-09-19** (i.e. days before this report); 53 stars, 23 forks, 3,744 tracked files, release-please automated releases, GCP Cloud Run deploys for prod/stage.

**(f) URLs.** https://platform.solana.com/docs · https://github.com/solana-foundation/solana-developer-platform · https://github.com/solana-foundation/solana-developer-platform/blob/main/apps/sdp-docs/content/docs/developing-with-sdp/idempotency.mdx

**Blunt conclusion.** SDP guarantees **at-most-once creation of its own backend records for a handful of its own endpoints**, backed by a Postgres unique index, with no TTL. It dedupes **backend HTTP requests**, **not logical intents onchain**, and it is neither permissionless nor composable. Its own source documents that a rebuilt transaction is a *different* request.

---

## 2. Solana Pay "reference keys" / the `reference` field

**Canonical spec (primary):** https://docs.solanapay.com/spec
**Spec in repo:** `solana-foundation/pay` → `typescript/packages/solana-pay/spec/SPEC.md` (and `SPEC1.1.md`)

**(a) Problem it solves.** Allowing a merchant to **correlate an incoming payment with an order before the payment transaction exists**. Verbatim:

> *"Because Solana validators index transactions by these account keys, `reference` values can be used as **client IDs** (IDs usable before knowing the eventual payment transaction). The `getSignaturesForAddress` RPC method can be used locate transactions this way."*

**(b) Layer.** Client/URL-scheme standard. A `solana:` transfer-request URL field that the **wallet** must include as read-only, non-signer account keys on the transfer instruction. Not a program, not an RPC, not a server.

**(c) What it deduplicates or guarantees.** **Nothing whatsoever.** The spec is unusually explicit:

> *"The values may or may not be unique to the payment request, and may or may not correspond to an account on Solana."*

There is no uniqueness requirement, no onchain check, no abort-if-seen, no receipt. It is a **locating/indexing device** — a tag baked into account keys so `getSignaturesForAddress` can find the tx later. It cannot prevent double execution; two payments with the same reference both land.

**(d) Permissionless/generic?** Generic as a URL field, but scoped to Solana Pay transfer requests (the wallet must attach it to a `SystemProgram.Transfer` or `TokenProgram.Transfer`/`TransferChecked`). It is not a general-purpose instruction-set primitive.

**(e) Maintenance.** The Solana Pay **spec** is stable/legacy (site footer © 2023). The repo `solana-foundation/pay` has been **repurposed**: it is now **pay.sh**, "CLI for Agentic payments (x402, MPP, AP2)", HEAD `0bd8e63` dated **2026-09-16**. The legacy SDK still ships: `@solana/pay` **1.0.26**, published **2026-07-31**. The spec files remain in-tree under `typescript/packages/solana-pay/spec/`.

**(f) URLs.** https://docs.solanapay.com/spec · https://github.com/solana-foundation/pay · https://github.com/solana-foundation/pay/blob/main/typescript/packages/solana-pay/spec/SPEC.md · https://registry.npmjs.org/@solana/pay

**Blunt conclusion.** Reference keys **locate** transactions; they do not dedupe them. The spec explicitly disclaims uniqueness. They are the nearest thing in the ecosystem to "an identifier attached to a payment," which is likely why they get mistaken for an idempotency mechanism — but there is no enforcement of any kind.

---

## 3. Helius Sender and Helius transaction-sending / priority-fee APIs

**Docs:** https://www.helius.dev/docs/sending-transactions/sender · .../sender-max · .../overview · .../send-manually · .../send-bundle · https://www.helius.dev/docs/priority-fee-api · https://www.helius.dev/docs/api-reference/rpc/http/sendtransaction

**(a) Problem it solves.** Latency and **inclusion probability** under congestion. Helius Sender *"submits your transaction across all pathways (Helius, Jito, Harmonic, Rakurai, etc.) simultaneously to give it the fastest possible route into a block."* Basic sending routes to current/upcoming leaders through a priority lane via SWQoS.

**(b) Layer.** Off-chain **transaction-submission endpoint / relayer**. HTTP/RPC edges (`https://sender.helius-rpc.com/fast`, regional `{slc,ewr,lon,fra,ams,sg,tyo}-sender.helius-rpc.com`, plus `mainnet.helius-rpc.com`). No client SDK required. Not a validator, not a program, not a leader. The Priority Fee API is a separate stateless read-only RPC method.

**(c) What it deduplicates or guarantees.** **Nothing. Zero dedup, zero idempotency semantics at any layer.** The primary source is explicit that the transaction is passed through untouched:

> *"This method does not alter the transaction in any way; it relays the transaction created by clients to the node as-is."*

Sender's only validation is **economic** (a required tip: ≥0.001 SOL for Sender Max, ≥0.000005 SOL for SWQOS-only; plus a priority fee), and the full error table contains only malformed/underfunded/rate-limit cases. The JSON-RPC `id` field is the **envelope ID**, not an idempotency key. There is no `Idempotency-Key` header and no request-level replay cache.

The only dedup is **Solana's own signature-keyed `AlreadyProcessed`** — and Helius documents duplicate confirmation as a **hazard you must avoid**, not a guarantee you receive:

> *"Only re-sign the transaction if you are also fetching a new blockhash. **Re-signing with the same blockhash can lead to duplicate transactions being confirmed.**"*

Retry logic is explicitly delegated to the caller: *"Set `maxRetries: 0` and implement your own retry logic."*

`sendBundle` returns a `bundle_id` = *"SHA-256 hash of the transaction signatures"* — a **content hash, not an idempotency key** (identical bytes ⇒ identical ID because the *input* is identical). Sender Max drops the bundle ID entirely.

Notably, Helius *does* dedupe — but only in **streaming/observability** products (LaserStream, Preconfirmations), never in delivery. A grep of the full 2.7 MB Helius doc corpus for `dedup|idempot|duplicate` found every match in a streaming/indexing/parsing context and **zero** in Sender, `sendTransaction`, `sendBundle`, or the Priority Fee API.

**(d) Permissionless/generic?** **Fully permissionless and generic** — arbitrary fully-signed transactions, any instruction set; only economic requirements. Sender itself requires no API key.

**(e) Maintenance.** Actively maintained, flagship product. Docs index `last_updated: 2026-09-17`; `helius-sdk` npm **3.2.0** (2026-09-08); `helius-labs/helius-rust-sdk` pushed 2026-09-16.

**(f) URLs.** As listed above, plus https://www.helius.dev/docs/llms.txt and https://www.helius.dev/docs/llms-full.txt.

**Blunt conclusion.** Helius Sender guarantees **routing and delivery attempts only** (multi-path fan-out + an economic gate). It dedupes **nothing** — not identical bytes, not HTTP requests, not durable nonces, not scheduled transactions, and certainly not logical intents. Two rebuilt transactions expressing the same intent will both execute.

---

## 4. Jito transaction delivery / bundles

**Docs:** https://docs.jito.wtf/ · https://docs.jito.wtf/lowlatencytxnsend/ · https://jito-foundation.gitbook.io/mev/jito-solana/features
**Proto (primary for dedup semantics):** https://github.com/jito-labs/mev-protos/blob/HEAD/bundle.proto · .../searcher.proto · .../json_rpc/http.md

**(a) Problem it solves.** Cross-transaction **atomicity** plus MEV/revert protection and priority landing via a tip auction run by an off-chain Block Engine feeding Jito-Solana validators.

**(b) Layer.** Four layers: **validator/leader** (modified Agave client, Jito-Solana), **off-chain block engine / auction** (`{region}.mainnet.block-engine.jito.wtf`), **backend API** (`getBundleStatuses`, `getInflightBundleStatuses`, tip floor), and **onchain program** (Tip Payment Program, 8 tip accounts).

**(c) What it deduplicates or guarantees.** Guarantees **atomicity**, which is *not* dedup:

> *"Sequentially: Transactions in a bundle are guaranteed to execute in the order they are listed. Atomically: Bundles execute within the same slot… All-or-Nothing: Bundles can only contain successful transactions. If any transaction in a bundle fails, none of the transactions in the bundle will be committed to the chain."*

Acceptance is not landing: *"This does not guarantee the bundle will be processed or land on-chain."* `bundle_id` is *"the SHA-256 hash of the bundle's transaction signatures"* — content-addressing, not idempotency. There is **no idempotency key**; the JSON-RPC `id` is a client-generated integer.

**The one dedup-adjacent mechanism, found in the protobuf spec rather than the docs site:**

```proto
enum DroppedReason {
  BlockhashExpired = 0;
  // One or more transactions in the bundle landed on-chain, invalidating the bundle.
  PartiallyProcessed = 1;
  NotFinalized = 2;
}
```

`PartiallyProcessed` is the closest thing in the ecosystem to a dedup signal — but it is a **post-hoc reaction** to Solana's `AlreadyProcessed`, not a pre-submission guard.

**UNVERIFIED:** that Jito *documents* "a bundle containing an already-landed transaction is rejected." No such verbatim statement was found. The conclusion is an inference from `PartiallyProcessed` + `AlreadyProcessed` + content-addressed IDs. Also **UNVERIFIED:** the full algorithm of "revert protection" beyond `bundleOnly=true`.

Atomicity itself has a documented escape hatch: *"imagine transactions from a bundle end up on an uncled block and some party rebroadcasts some or all of the bundle transactions. Those transactions will hit the normal banking stage **which does not respect the bundle atomicity and reversion protection rules**."* Jito's advice is that the caller add pre/post account checks.

Also practically important: bundle status is **not durably queryable** — `getBundleStatuses` covers ~300 rooted slots and `getInflightBundleStatuses` only 5 minutes, after which a landed bundle and a never-submitted one are indistinguishable.

**(d) Permissionless/generic?** **Fully permissionless and generic** over arbitrary instruction sets; only requirement is a SOL transfer to one of 8 static tip accounts. Jito-Solana is open source and permissionless to run.

**(e) Maintenance.** Split. Validator client very active (`jito-labs/jito-solana` pushed 2026-09-19); docs updated 2026-09-09. **But client libraries and protobuf schemas are dormant since mid/late 2025** — `mev-protos` pushed 2025-07-23, `searcher-examples` 2025-10-21, `jito-js-rpc` 0.2.2 (2025-06-15), `jito-ts` 4.2.1 (2025-09-10), `jito-sdk-rust` 0.3.2 (2025-06-21) — a ~14-month gap. Jito has also been partly superseded by **BAM (Block Assembly Marketplace)**.

**(f) URLs.** As listed above.

**Blunt conclusion.** Jito guarantees **ordered, same-slot, all-or-nothing bundle execution** (with a documented uncled-block escape hatch) and guarantees **nothing about dedup**. Two rebuilt, re-signed transactions expressing the same intent have different signatures ⇒ a different SHA-256 bundle ID ⇒ both will execute.

---

## 5. Triton One transaction delivery

**Docs:** https://docs.triton.one/chains/solana/cascade · .../cascade/transaction-submission · .../cascade/sending-txs · https://docs.triton.one/project-yellowstone/dragons-mouth-grpc-subscriptions · https://docs.triton.one/chains/solana/shred-streaming
**Repo:** https://github.com/rpcpool/yellowstone-grpc

**Scoping correction:** there is **no product called "Triton Sender."** The functional equivalent is **Cascade**; the streaming product is **Yellowstone Dragon's Mouth gRPC**.

**(a) Problem it solves.** Cascade: delivery success rate under congestion via **SWQoS** staked-validator private connection pools. Yellowstone gRPC: **observability latency** — a Geyser-fed streaming interface (account writes, transactions, deshred, entries, blocks, slots).

**(b) Layer.** Cascade = **RPC endpoint + relayer/forwarding network** (`sendTransaction`, plus `POST /sendtx`). Yellowstone = **streaming/observability interface** served from a validator-side Geyser plugin — read-only.

**(c) What it deduplicates or guarantees.** **Yellowstone dedupes nothing about transactions**, and Triton says dedup is the client's job:

> *"Replay starts at a slot boundary. If you reconnect from the last slot you processed, **you may receive duplicate updates from that slot, so clients should deduplicate.**"*
> Fumarole: *"guarantees **at-least-once** delivery… Your downstream processing must tolerate seeing the same slot twice without producing duplicate side effects."*

**Cascade dedupes nothing either**, and explicitly pushes retries to the client:

> *"**Handle retries in your own code.** Do not rely on the RPC node to retry for you. When sending, set **`maxRetries: 0`**."*

The `/sendtx` parameter set is `encoding`, `response`, `max_retries` — no `id`, no `Idempotency-Key`, no dedup window. `max_retries` is a retry knob, the opposite of dedup.

**The only server-side dedup anywhere in Triton's stack** is first-copy-wins packet dedup on the raw **shred read feed** — *"whichever copy arrives first is the one you get, and later duplicates are discarded."* This is a network-broadcast concern on a **read** feed and has no bearing on what executes. Worth naming because it is easy to misread as a delivery guarantee.

Triton's priority-fee API (a patched `getRecentPrioritizationFees` with a `percentile` parameter) is a stateless estimator — dedupes nothing. A grep of the 461 KB Triton doc corpus for `dedup|idempot|duplicate` found 16 matches, all in streaming/replay/failover context, **zero** in Cascade or `/sendtx`.

**(d) Permissionless/generic?** Cascade: fully permissionless and generic (arbitrary signed transactions; commercial subscription is the only gate). Yellowstone: generic streaming with arbitrary filters. One documented exclusion: the Light Protocol / ZK Compression program is excluded from all Dragon's Mouth streams.

**(e) Maintenance.** Very active. `rpcpool/yellowstone-grpc` pushed 2026-09-17 (1,006★, AGPL-3.0); stable release **v15.2.1+solana.4.2.2** (2026-09-10); RC v16.0.0-rc9 (2026-09-17); `yellowstone-grpc-client` 13.5.1 (2026-09-15); `@triton-one/yellowstone-grpc` 7.0.1 (2026-08-31).

**(f) URLs.** As listed above.

**Blunt conclusion.** Cascade guarantees **SWQoS forwarding attempts only** and dedupes nothing. Yellowstone gRPC delivers **at-least-once** and requires clients to deduplicate replayed slots themselves. Two rebuilt transactions expressing the same intent will both execute.

---

## 6. Squads Protocol `nonce-guard` — **read the code; the name is misleading**

**Repo:** https://github.com/Squads-Protocol/nonce-guard
**Read directly:** `README.md`, `src/instructions/execute_guarded.rs`, `src/errors.rs`, `src/state/guarded_account.rs`, `Cargo.toml`, `tests/guarded_proxy.rs` (cloned at HEAD)

**First, the headline correction.** Despite the name, **`nonce-guard` is not an idempotency mechanism at all, and it is not a "nonce manager."** It is a **PDA proxy-signer** whose defining behaviour is to **reject durable-nonce transactions**. Its own README says so:

> *"Nonce Guard is a lightweight Solana/SVM program for executing instructions through an owner-derived PDA while **rejecting transactions that use durable nonces**… **Durable nonce protection: inspect the instructions sysvar and reject transactions that advance or consume a durable nonce.**"*

**(a) Problem it solves.** Letting an application have a deterministic PDA sign downstream CPIs, **without** that execution path being reachable from a durable-nonce transaction. Durable nonces let a signed transaction be held and submitted arbitrarily later — a replay/latency vector for policy-gated execution. `nonce-guard` closes that door. The README frames the motivation as wanting a PDA signer but not wanting that path *"available from a durable nonce transaction."*

**(b) Layer.** **Onchain program**, deployed to **mainnet-beta and devnet at `guardgkc38afzaHQ7LNAtWHKgdUAAwyayhNdY8MPNnw`** (per `Cargo.toml` `[package.metadata.solana] program-id` and README). Single instruction: `execute_guarded`. Ships generated TypeScript and Rust clients plus a Codama definition.

**(c) What it precisely inspects — from the source.** The check is one line in `ExecuteGuardedContext::load`:

```rust
ensure_never_nonce(instructions_sysvar, NonceGuardError::DurableNonceBlocked)?;
```

It loads the **instructions sysvar** (account index 2) and, via the `p-never-nonce` crate (`p-never-nonce = "0.2.0"` in `Cargo.toml`), fails if the transaction contains an **advance-nonce** instruction, returning custom error `DurableNonceBlocked = 6`. Confirmed by the LiteSVM test `rejects_system_transfer_when_transaction_uses_durable_nonce`, which asserts exactly `InstructionError::Custom(NonceGuardError::DurableNonceBlocked as u32)`.

**It deduplicates nothing.** There is no key, no receipt, no set of seen values, no retention window. It inspects *the shape of the transaction* (does it advance a nonce?) and rejects a *class* of transaction. **It is the opposite of a dedup primitive: it makes one replay-enabling mechanism impossible, rather than making repeated execution impossible.**

**The PDA it derives is per-owner, not per-intent** — `src/state/guarded_account.rs`:

```rust
pub const GUARDED_ACCOUNT_SEED: &[u8] = b"guarded_proxy";
pub fn derive_guarded_account_address(owner: &Address) -> (Address, u8) {
    Address::find_program_address(&[GUARDED_ACCOUNT_SEED, owner.as_ref()], &ID)
}
```

Seeds are `["guarded_proxy", owner]` — **one PDA per owner, with no namespace, no key, and no account data** ("guarded accounts are PDAs derived from the owner and **do not require program-owned account data**"). It cannot express "this specific intent already ran."

The program's own **Responsibility** section disclaims exactly the guarantee CommitOnce provides:

> *"users accept full responsibility for any consequences of use, including losses caused by… **assumptions about replay and nonce behavior**."*

**(d) Permissionless/generic?** The program is generic in that it can CPI *any* compiled instruction set (Borsh-encoded `CompiledInstruction` list, compact positional account indices, self-CPI blocked). But it is **not an idempotency primitive**, so this question is largely moot. Note the sharp security caveat in its own README: *"The guarded PDA can sign **any** CPI encoded in the `execute_guarded` instruction"* and *"incorrect ordering can cause the wrong CPI target or account metas to be used."*

**(e) Maintenance.** **v0.1.0, single commit, no tags.** HEAD `4c936a8` dated **2026-06-16** ("add: readme"), author 0xRigel. 0 stars, no description, MIT. Includes an OtterSec audit PDF (`audits/ottersec_audit.pdf`) and a verifiable-build toolchain pin. Effectively a fresh, unproven release.

**(f) URLs.** https://github.com/Squads-Protocol/nonce-guard · https://github.com/Squads-Protocol/nonce-guard/blob/main/src/instructions/execute_guarded.rs · https://github.com/Squads-Protocol/nonce-guard/blob/main/src/state/guarded_account.rs

### 6b. The dependency worth knowing: `p-never-nonce`

`nonce-guard`'s durable-nonce detection is **not its own invention** — it delegates to a small public crate, which is itself a **generic, permissionless, composable onchain guard program**:

**Crate:** https://crates.io/crates/p-never-nonce — *"Ensure a transaction does not include an advance nonce instruction."* v0.2.0, created 2026-04-02, **49 downloads**. Repo: https://github.com/febo/pinocchio-never-nonce (by `febo`, a Pinocchio maintainer). Apache-2.0.

It offers **three** integration modes, all permissionless and generic:
1. **Library** — `ensure_never_nonce(&instructions_sysvar, ProgramError::InvalidArgument)`.
2. **CPI** — invoke the deployed "never-nonce" program: `NeverNonce { instructions_sysvar }.invoke()`.
3. **Instruction builder** — `p_never_nonce::instruction::never_nonce()`.

Deployed program ID `pnn1ctaR1tbP7EGrcz3WtrJKknRxKmKqADztKY9C3YJ`, with a **verifiable build** (`solana-verify`), expected executable hash `f9f145339d050163327b345e035a94adfee2b3f68cc8b5d41487403ab0d1f32f`.

**Why this matters enormously for the verdict.** `p-never-nonce` proves that the exact architectural pattern CommitOnce proposes — *"a tiny generic program you prepend/CPI into your existing transaction, which inspects the transaction and aborts it if a precondition is violated"* — **is already established, permissionless, generic, mainnet-deployed prior art with reproducible builds.** The ecosystem has already accepted this UX shape. What `p-never-nonce` guards is **durable-nonce usage**, not duplicate intents. The *plumbing* exists; the *invariant* differs.

---

## 7. Helium `lazy_transactions`

**Repo:** https://github.com/helium/helium-program-library (HEAD `75111f5`, **2026-09-15** — active)
**Read directly:** `programs/lazy-transactions/README.md`, `src/instructions/execute_transaction_v0.rs`, `src/instructions/close_marker_v0.rs`, `src/state.rs`, `src/util.rs`, and `packages/docsite/src/pages/docs/api/lazy-transactions-sdk.md`

**(a) Problem it solves.** Pre-authorising an enormous set of transactions offchain and letting anyone execute the one relevant to them, by committing only a **Merkle root** onchain:

> *"Commits a Merkle root of pre-authorised transactions on-chain and lets anyone execute any leaf by presenting the proof. We pre-compute the enormous set of migration transactions off-chain, publish only the root, and then users (or a cranker) execute the one relevant to them."*

Used for the **HNT L1 → Solana migration** and **welcome-pack issuance**.

**(b) Layer.** **Onchain program** (+ TypeScript SDK `@helium/lazy-transactions-sdk`, + an admin CLI `close-lazy-transaction-markers.ts`).

**(c) What it precisely guarantees — and this is a genuine at-most-once marker.** It has real execute-once semantics, implemented **twice over**:

1. **A bitmap** — `LazyTransactionsV0` carries `executed_transactions: Pubkey`, and the account constraint on `execute_transaction_v0` is:

```rust
constraint = !is_executed(&executed_transactions.try_borrow_mut_data()?[1..], args.index)
    @ ErrorCode::TransactionAlreadyExecuted,
```

with `is_executed`/`set_executed` operating on a bit indexed by `args.index` (`util.rs`). The handler sets the bit **before** executing the CPIs.

2. **A PDA "Block" marker** — the legacy mechanism, still present:

```rust
pub struct Block {
  // Empty account that blocks tx from going through more than once
}
```

seeded `["block", lazy_transactions.key(), index.to_le_bytes()]`, with `close_marker_v0` to reclaim it.

So it dedupes **a Merkle leaf index within one `LazyTransactionsV0` instance**. It is *robust to rebuild* in the same way CommitOnce is — the marker is onchain state, not derived from the signature.

**But it is materially not a generic idempotency primitive:**
- **You cannot prepend it to an arbitrary transaction.** The instructions to be executed must be **pre-committed into the Merkle tree** by the `authority`, and `execute_transaction_v0` verifies a proof against the stored `root` (`if !verify(proof, root, hash, args.index) { return Err(InvalidData) }`). Your business instructions must be *already in the tree*.
- The "key" is a **`u32` leaf index fixed at commit time**, not a caller-chosen `(authority, namespace, idempotency key)`.
- It is **authority-gated**: a root publisher controls what can ever be executed.
- **No retention window** — bits are permanent; the bitmap size is fixed by `max_depth` at initialization (`get_bitmap_len`), so key space must be pre-provisioned.
- It is a **crank/claim-execution engine**, not an idempotency guard.

**(d) Permissionless/generic?** **App-specific.** Helium's own migration and welcome-pack flows. Generic only in the sense that a different team could fork it and commit their own root — but then they own the authority and the tree, so it is not a shared permissionless primitive.

**(e) Maintenance.** Active — repo HEAD 2026-09-15, release/upgrade via `program-lazy-transactions-<version>` git tags.

**(f) URLs.** https://github.com/helium/helium-program-library/tree/master/programs/lazy-transactions · https://github.com/helium/helium-program-library/blob/master/programs/lazy-transactions/src/instructions/execute_transaction_v0.rs · https://github.com/helium/helium-program-library/blob/master/programs/lazy-transactions/src/state.rs

**Blunt conclusion.** `lazy_transactions` genuinely implements **at-most-once execution of a pre-committed transaction leaf, robust to rebuild** — a real onchain receipt/commit-marker pattern, and the strongest "execute-once" implementation found in production Solana code. But it dedupes **a leaf index inside an authority-owned Merkle tree**, requires your instructions to be pre-committed, is authority-gated, and has no retention window. It is **not** a permissionless, composable, arbitrary-instruction-set idempotency key.

---

## 8. Exhaustive scan: does a Solana onchain idempotency / intent / nonce-manager / execute-once product exist?

### 8.1 Master candidate table

★ = genuinely relevant to the CommitOnce concept.

| Name | URL | Layer | What it dedupes | Generic vs app-specific | Maintenance |
|---|---|---|---|---|---|
| **Light Protocol `nullifier-program`** ★ | https://github.com/Lightprotocol/nullifier-program | **Onchain program** (separate, mainnet + devnet) | Caller-chosen 32-byte `id` via PDA `["nullifier", id]`; abort if exists | **GENERIC + permissionless** | Created 2026-02-02; crate `light-nullifier-program` 0.1.2 (**71 downloads**); npm 0.1.3 (2026-02-05). **Explicitly unaudited.** "Light is joining Helius." |
| **`sol_idempotent`** (Flawm/solana_idempotent) ★ | https://github.com/Flawm/solana_idempotent | Onchain program (separate; mainnet `id7Fj1ywco2RdzTcQFNcYxf6Wu9iJZeNPtQY9xdsw87`) | `u32` bit index in an owner-scoped bitmap; `err!(AlreadyRan)` if set | **GENERIC but primitive** — bare bit index, client interprets meaning; no namespace, no PDA derivation, no retention | **Abandoned** — last push 2023-04-21, 3★, Anchor 0.24.2 |
| **`solana-asm/shield`** | https://github.com/solana-asm/shield | Onchain (7 deployed guard programs) | **Nothing stateful** — stateless preconditions (slot deadline, slippage, balance floor, signer/program allowlists, fee ceiling, CU floor) | Generic permissionless architecture, **explicitly STATELESS** | Active: 2026-05-31, 3★; npm `@solana-asm/shield` |
| **IntentGuard** | https://github.com/selcuk07/intentguard | Onchain (devnet only) | One active intent hash per `(user, app_id)` PDA, closed on verify | Generic, but **commit-reveal / 2FA across two transactions**, not idempotency | crates `intentguard-cpi` 0.2.0, npm `intentguard-sdk` 0.2.0 (2026-03-05); mainnet unchecked |
| **Trana** | https://github.com/beharefe/trana | Onchain (devnet) | WebAuthn proof + per-owner nonce increment | Generic CPI primitive, but **passkey 2FA**, not idempotency | `trana_guard` 0.1.0 (2026-05-11) |
| **Prova** | https://github.com/Eras256/Prova | Onchain + SDK | Nothing — append-only attestation receipts; **explicitly rejects one-PDA-per-receipt** | Generic attestation rail; does not abort anything | Active 2026 |
| `comprido96/solana-reward-claim` | https://github.com/comprido96/solana-reward-claim | Embedded in an app program | `(player, reward_id)` PDA + Anchor `init` | **APP-SPECIFIC** (canonical idiom) | Study repo, 2026-08-24 |
| `Prive-Concierge/card-auto-topup-program` | https://github.com/Prive-Concierge/card-auto-topup-program. | Embedded | "delegated, idempotent" card funding + onchain limits | **APP-SPECIFIC** | 0★, 2026-07-04 |
| Soloraa | https://github.com/UdayPandey01/Soloraa | Embedded | Monotonic per-wallet nonce + expiry slot | **APP-SPECIFIC** | 2026-05-20, 2★ |
| `MrBoodj011/solana-dev` | https://github.com/MrBoodj011/solana-dev | Client lib | Bounded in-memory nonce window | **Not onchain** | 2026-08-06 |
| `l1fexx/noncepay-guard` | https://github.com/l1fexx/noncepay-guard | Plugin | Nothing — policy caps; uses durable nonce as lifetime | Not onchain state | 2026-08-07 |
| `swarmproof/exactly-once` | https://github.com/swarmproof/exactly-once | Backend middleware | Stable key → atomic claim → replay stored result | Offchain | Active, PyPI |
| `AaronTan11/solana-nonce-guard` | https://github.com/AaronTan11/solana-nonce-guard | Client | Nothing — detects durable-nonce attack vectors | Security detector | 2026-04-02 |
| Various pre-sign scanners (`solana-tx-guard`, `fifty-guard`, `Sentinel-MWA`, `Wallet-Transaction-Guard`) | e.g. https://github.com/mstevens843/solana-tx-guard | Client | Nothing — simulation/risk flags | Not dedup primitives | 2026 |

### 8.2 THE key finding — Light Protocol `nullifier-program` (independently verified in this session)

**A generic, permissionless, composable onchain idempotency primitive that is robust to rebuilt transactions already exists on Solana, is live on mainnet and devnet, and is officially documented as serving exactly CommitOnce's use case.**

**Program ID:** `NFLx5WGPrTHHvdRNsidcrNcLxRruMC92E4yv7zhZBoT`
**Official doc:** https://www.zkcompression.com/compressed-pdas/nullifier-pda
**Source:** https://github.com/Lightprotocol/nullifier-program/blob/main/programs/create-nullifier/src/lib.rs

The official documentation says, verbatim:

> *"For some use cases, such as sending payments, you might want to **prevent your on chain instruction from being executed more than once**… The nullifier program utility solves this for you.*
> *1. It derives PDA from `["nullifier", id]` seeds (where `id` is your unique identifier, e.g. a nonce, uuid, hash of signature, etc.)*
> *2. Creates an empty rent-free PDA at that address*
> *3. **If the address exists, the whole transaction fails***
> *4. **Prepend or append this instruction to your transaction.**"*

The doc lists **Networks: Mainnet, Devnet**, cost ~15,000 lamports (~0.000015 SOL), and shows the exact usage pattern — `nullifier_ix` first, then your business instruction, in one `Transaction`:

```rust
let nullifier_ix = create_nullifier_ix(&mut rpc, payer.pubkey(), id).await?;
let transfer_ix = system_instruction::transfer(&payer.pubkey(), &recipient, 1_000_000);
let tx = Transaction::new_signed_with_payer(
    &[nullifier_ix, transfer_ix], Some(&payer.pubkey()), &[&payer], recent_blockhash,
);
```

**Verified in the program source:**

```rust
let (address, address_seed) =
    derive_address(&[b"nullifier", &id], &address_tree_pubkey, &crate::ID);
```

**Verified deployed onchain by direct RPC `getAccountInfo` in this session:**
- mainnet-beta: `owner=BPFLoaderUpgradeab1e11111111111111111111111`, `executable=True`
- devnet: `executable=True`

**This is mechanically the same invariant as CommitOnce.** Prependable guard instruction in the *same atomic transaction*; deterministic PDA receipt; abort the whole transaction if it already exists; and — crucially — because the receipt is onchain state keyed by a caller-chosen `id` rather than derived from transaction bytes, **it survives a rebuilt transaction with a new blockhash and therefore a new signature.** The doc even suggests `id` = *"hash of signature"* or a uuid/nonce.

#### The six material differences (this is the actual competitive surface)

1. **No authority scoping → griefable and front-runnable.** The seeds are `["nullifier", id]` — **the signer is not in the seeds**. The accounts struct is literally just `GenericAnchorAccounts { #[account(mut)] signer: Signer }` — a fee payer, not a namespace component. **Anyone who learns or predicts an `id` can consume it first and permanently block the legitimate user's transaction.** CommitOnce's `(authority, namespace, idempotency key)` keying closes this *by construction*; here the caller must remember to hash their own pubkey into `id`, and the protocol does not enforce it.
2. **Not self-contained — it requires an RPC.** `create_nullifier_ix(rpc, payer, id)` **fetches a Light Protocol validity proof** from a prover/indexer before the instruction can be built (`fetch_proof`; examples construct a `LightClient` with an explicit `photon_url` and a **Helius API key**). CommitOnce explicitly positions itself as "**NOT an RPC**." This primitive *is* RPC-dependent.
3. **Compressed-account dependency, not a plain rent-exempt PDA.** ~15,000 lamports, backed by Light's state trees, requiring `ValidityProof`, `address_tree_info`, `output_state_tree_index`, and remaining accounts for a Light System Program CPI. The program is upgradeable (`BPFLoaderUpgradeable`), so behaviour is subject to an upgrade authority.
4. **No namespace field.** A single opaque 32-byte `id`; multi-tenancy and per-app key spaces are caller responsibility.
5. **Explicitly unaudited.** README, verbatim: *"The nullifier program code is unaudited, use at your own risk."* The doc calls it *"a reference implementation. Feel free to fork the program as you see fit."*
6. **Negligible adoption.** 71 crate downloads; npm 0.1.3 last published 2026-02-05. Mainnet-live ~7 months with effectively zero traction. No product, dashboard, support surface, or retention-window policy. And Light's own docs banner reads **"Light is joining Helius"** — a continuity/ownership risk.

**Retention-window caveat (partially UNVERIFIED):** Light compressed accounts support `close`/`reinit` at the same address at the Light-system level, but the nullifier program exposes only `create_nullifier` with no close path, so the marker should be permanent in practice. Whether an upgrade or a system-level close could un-spend a nullifier is **UNVERIFIED**.

### 8.3 Second instance: `sol_idempotent` (abandoned)

https://github.com/Flawm/solana_idempotent — mainnet `id7Fj1ywco2RdzTcQFNcYxf6Wu9iJZeNPtQY9xdsw87` (**RPC-verified `executable=True` in this session**). README: *"Include the transaction instructions atomically with transactions when you want to guarantee they don't run twice. This uses an on-chain bitmap… It is left up to the client to interpret which bits represent transactions."* The whole program is ~40 lines: `mark_bit(bit: u32)` → `err!(CustomError::AlreadyRan)` if set. Same invariant, but keyed by a **bare `u32` bit index**, no PDA derivation (the bitmap is a separately-created keypair account), single mutable account per map (contention hotspot), fixed pre-provisioned key space, and **abandoned since 2023-04-21** (Anchor 0.24.2).

### 8.4 The near-miss on architecture: `solana-asm/shield`

https://github.com/solana-asm/shield is the closest thing to CommitOnce's *architecture* — tiny separate deployed guard programs you prepend to any transaction, relying on Solana's all-or-nothing atomicity. README, verbatim:

> *"Each 'what if' becomes its own tiny program. You stick the check in front of your real action in the same transaction."*
> *"**No shared state.** The guards don't talk to each other and **don't remember anything between transactions**."*

All seven guards (`slot_deadline`, `slippage`, `balance_floor`, `signer_allowlist`, `fee_ceiling`, `program_allowlist`, `compute_unit_floor`) are **stateless**. `slot_deadline` is described as useful for *"replay-protecting off-chain-signed intents"* — but that is a **deadline** (bounds *when* a tx may land), not a keyed receipt (bounds *whether this intent already ran*).

**So: the "prepend a guard instruction to any transaction" pattern is established prior art, but every deployed instance of it is stateless — except Light's nullifier program.**

### 8.5 Registry searches — nothing shipped

- **crates.io** — searched `idempotency`, `idempotent`, `solana idempotent`, plus (subagent) `solana nonce`, `solana guard`, `solana receipt`, `solana intent`, `solana replay`. **No crate implements an onchain Solana idempotency-key primitive.** Every `idempotency` hit is offchain HTTP/queue middleware (`runledger-*`, `minco-plugin-idempotency`, `kcode-kweb-idempotency`, `idempotent`). `solana nonce` hits are Anza's durable-nonce plumbing.
- **npm** — searched `solana idempotency`, `solana idempotent`, `idempotency key solana`, plus (subagent) `solana guard instruction`, `onchain idempotency`, `solana exactly once`, `solana deduplication`, `solana nonce manager`. **No Solana onchain idempotency guard package exists.** `solana idempotency` returns only `@solana/*` Kit monorepo noise; `onchain idempotency` returns only offchain middleware.
- **GitHub repository search** — `solana+idempotency` (4 results, none relevant), `solana+idempotency+key` (0), `solana+exactly-once` (1, unrelated), `solana+replay+protection` (9, all app-specific study repos), `solana+receipt+program` (6, unrelated), `solana+nonce+manager` (**0**), `solana+intent+program` (4, unrelated), `solana+guard+instruction+program` (**0**), `solana+idempotency+program+anchor` (**0**), `solana+at-most-once` (**0**), `solana+exactly+once+execution` (**0**).
- **Solana ecosystem directory** — `https://solana.com/ecosystem` is a navigation hub (Network / Community / Categories), not a queryable product directory. No idempotency/intent category. `solana.com/docs` and `/developers` contain **no mention of idempotency**.
- **SIMD proposals** — of ~130 Solana Improvement Documents enumerated, only three matched `nonce`/`replay`/`idempot` (`0242-static-nonce-account`, `0297-relax-invalid-nonce`, `0610-prohibit-nonce-self-withdrawals`). **None proposes onchain idempotency.**

### 8.6 Target 8 conclusion

**A generic permissionless onchain idempotency primitive robust to rebuilt transactions DOES already exist on Solana: Light Protocol `nullifier-program`.** It is the only candidate simultaneously generic, permissionless, mainnet-live, and rebuild-robust. `sol_idempotent` is a second, weaker, abandoned instance. Nothing else qualifies.

**But no *product* exists around it.** No vendor markets this as an idempotency product; no SDK wraps it as an idempotency key with a namespace, authority binding, retention policy, or observability. The primitive exists as a **reference implementation on a ZK-compression docs site** — unaudited, 71 downloads, no product surface — and is architecturally different in the two ways that matter most: **no authority scoping** (griefable) and a **required RPC proof fetch**.

---

## 9. Onchain "receipt" / "commit marker" patterns on Solana

The distinction that matters: **(i)** an app-specific "already claimed/consumed" marker — one PDA per user per campaign, hardcoded to one program's business logic, requiring the business instruction to live in *that same program*; versus **(ii)** a generic reusable primitive that a *different* program can prepend or CPI into.

| Pattern | URL | (i) or (ii)? | Mechanism |
|---|---|---|---|
| **Anchor `init` PDA as replay guard** | https://github.com/comprido96/solana-reward-claim · https://www.anchor-lang.com/docs/references/account-constraints | **(i)** | `claim_record` PDA seeded `(player, reward_id)` with `init`; duplicate → *"account already in use"* |
| **Light Protocol `nullifier-program`** | https://github.com/Lightprotocol/nullifier-program | **(ii)** | `["nullifier", id]` PDA; abort if exists; prepend to any tx |
| **`sol_idempotent` bitmap** | https://github.com/Flawm/solana_idempotent | **(ii)**, degraded | `mark_bit(u32)` on an owner-scoped bitmap |
| **IntentGuard `IntentCommit`** | https://github.com/selcuk07/intentguard | **(ii)**, but commit-reveal | `["intent", user, app_id]` PDA; `verify_intent` checks hash **and closes** the PDA; TTL 30s–1h. Two separate transactions (trusted device commits, dApp verifies) — not one atomic guard |
| **Trana passkey registry** | https://github.com/beharefe/trana | **(ii)**, different purpose | `["passkey", owner]` registry PDA; verifies WebAuthn, increments nonce |
| **Helium `Block` PDA marker** | https://github.com/helium/helium-program-library/blob/master/programs/lazy-transactions/src/state.rs | **(i)** | Empty PDA `["block", lazy_transactions, index]` — *"Empty account that blocks tx from going through more than once"* |
| **Light merkle-distributor / simple-claim** | https://github.com/Lightprotocol/program-examples | **(i)** | Compressed PDAs track claims/vesting |
| **ZK nullifier apps** (`b-bhu/encore`, `pprogrammingg/zk-spot-shield`, `Slamanii/IDv2`, `sakasu-labs/sakasu`, …) | e.g. https://github.com/b-bhu/encore | **(i)** | Commitment/nullifier per app: vote/claim/ticket |
| **Prova attestation receipts** | https://github.com/Eras256/Prova | **(i)** | Ed25519-sealed receipts; **explicitly rejects one-PDA-per-receipt**; an audit log that does not *abort* anything |
| **Solana Attestation Service** | https://attest.solana.com | **(i)** | Attestation PDAs, not dedup |
| **`cardinal-receipt-*`** | crates.io | **(i)** | NFT receipts for rentals/claims; unmaintained 2022–23 |
| **Meteora/Jupiter/Kamino position PDAs** | n/a | **(i)** | Position bookkeeping, not commit markers. **UNVERIFIED in detail** — asserted from architecture, not individually fetched |

**Is Anchor's `init` constraint commonly used AS an idempotency guard? YES — it is the de facto Solana idiom.** The clearest primary-source statement is `comprido96/solana-reward-claim`'s README, verbatim:

> *"Each claim creates a `claim_record` PDA seeded by `(player, reward_id)` with Anchor's `init` (never `init_if_needed`, never `close`). A duplicate claim fails on 'account already in use.' The `(player, reward_id)` pair is the replay nonce."*

Anchor's own docs confirm the semantics: `init` *"Creates the account via a CPI to the system program and initializes it"*, whereas `init_if_needed` *"only runs if the account does not exist yet"* — i.e. **`init` = create-or-fail (a guard), `init_if_needed` = upsert (which defeats the guard)**. That the ecosystem warns *"never `init_if_needed`"* is itself evidence the idiom is understood as a replay guard.

**Structural conclusion for Target 9.** The `(authority, namespace, key)` → PDA → abort-if-exists invariant is **well-established prior art inside individual Solana programs**. What does not exist is a **separate, generic, permissionless program providing it for arbitrary third-party instructions** — with the single partial exception of Light's nullifier program. Every app-specific instance is siloed: it works only for instructions the same program defines.

---

## 10. EVM / other-chain analogues

### 10.1 Mechanism table

| Mechanism | Chain | Source | What it dedupes | Robust to rebuild? |
|---|---|---|---|---|
| EIP-155 chainId in signing preimage | EVM | https://eips.ethereum.org/EIPS/eip-155 | Signed payload, **cross-chain only** | n/a |
| Account nonce (equality predicate) | EVM | https://eips.ethereum.org/EIPS/eip-4337 | A **nonce slot** | **No** |
| Account nonce cap 2^64−1 | EVM | https://eips.ethereum.org/EIPS/eip-2681 | Bounds the counter | No |
| `NonceManager` (ethers v6) | EVM offchain | https://github.com/ethers-io/ethers.js/blob/main/src.ts/providers/signer-noncemanager.ts | Nothing onchain — local allocator | No |
| `createNonceManager` (viem) | EVM offchain | https://github.com/wevm/viem/blob/main/src/utils/nonceManager.ts | Nothing onchain | No |
| ERC-4337 2D nonce (`key`‖`seq`) | EVM | https://eips.ethereum.org/EIPS/eip-4337 | Per-`key` **monotonic counter** | **No** for `seq`; **partial/account-gated** for `key` |
| ERC-4337 `NonceManager.sol` | EVM | https://github.com/eth-infinitism/account-abstraction/blob/develop/contracts/core/NonceManager.sol | `(sender, key, seq)` slot | Same as above |
| **EIP-1014 `CREATE2` + EIP-684 collision revert** | EVM | https://eips.ethereum.org/EIPS/eip-1014 | A **keyed slot** `(deployer, salt, keccak(init_code))` | **Yes** |
| Arachnid deterministic-deployment-proxy | EVM (many chains) | https://github.com/Arachnid/deterministic-deployment-proxy | Same as CREATE2, chain-independent address | **Yes** |
| Safe Singleton Factory / CreateX | EVM (many chains) | https://github.com/safe-global/safe-singleton-factory · https://github.com/pcaversaccio/createx | Same as CREATE2 | **Yes** |
| `SELFDESTRUCT` post-Cancun | EVM | https://eips.ethereum.org/EIPS/eip-6780 | Protects CREATE2 receipts from being un-consumed | n/a |
| Tornado Cash nullifier set | EVM | https://github.com/tornadocash/tornado-core/blob/master/contracts/Tornado.sol | A **specific note** (one deposit) | Yes, but app-scoped mapping |
| **Semaphore nullifier `hash(secret, scope)`** | EVM | https://docs.semaphore.pse.dev/technical-reference/circuits | One-shot per `(identity, scope)` | **Yes** — closest structural match on EVM, but group-bound |
| MACI | EVM | https://github.com/privacy-scaling-explorations/maci/blob/main/packages/contracts/contracts/Poll.sol | **No onchain dedup** — dedup is offchain in the coordinator's circuit | n/a |
| Cosmos `Sequence` | Cosmos | https://github.com/cosmos/cosmos-sdk/blob/main/docs/architecture/adr-070-unordered-account.md | **Monotonic counter** | **No** |
| **Cosmos unordered txs (ADR-070)** | Cosmos | https://docs.cosmos.network/sdk/latest/reference/architecture/adr-070-unordered-account | **Keyed slot** `(signer, timeout_timestamp)` | **Yes** — shipped; 10 min max TTL |
| NEAR access-key nonce | NEAR | https://nomicon.io/RuntimeSpec/Transactions.html | A **nonce value** on one access key | **No** (strictly-greater) |
| NEP-366 `DelegateAction` nonce | NEAR | https://github.com/near/NEPs/blob/master/neps/nep-0366.md | Same access-key nonce | **No** |
| Aptos `sequence_number` | Aptos | https://aptos.dev/en/network/blockchain/accounts | **Contiguous monotonic counter** | **No** |
| **Aptos orderless txs (AIP-123)** | Aptos | https://github.com/aptos-foundation/AIPs/blob/main/aips/aip-123-orderless-transactions.md | **Keyed slot** `(sender, client-chosen u64 nonce)` | **Yes** — duplicate → `NONCE_ALREADY_USED` *"even with a different expiration time"* |
| Sui object versions | Sui | https://docs.sui.io/develop/objects/versioning | `(object ID, version)` — no nonce | **Partial/client-dependent** |
| Bitcoin `nSequence` / RBF (BIP-125) | Bitcoin | https://github.com/bitcoin/bips/blob/master/bip-0125.mediawiki | Replaceability **signal** | n/a |
| BIP-68 relative lock-time | Bitcoin | https://github.com/bitcoin/bips/blob/master/bip-0068.mediawiki | Nothing — `nSequence` is a **timelock**, not replay protection | n/a |

### 10.2 The key analytical point: why an EVM account nonce is NOT a keyed idempotency receipt

**What is actually deduped.** EVM's validity predicate is an *equality against a counter*: `tx.nonce == account.nonce`, incremented on inclusion. That yields two effects routinely conflated:

1. **Signed-payload replay is impossible.** The nonce is covered by the signature. After inclusion the account nonce is `N+1` while the old bytes declare `N`; resubmitting identical bytes fails with `ErrNonceTooLow`. Genuinely robust — but **payload-level**.
2. **Logical-intent re-execution is NOT prevented.** Nothing relates a transaction to an "intent." A rebuilt transaction — new blockhash, new fee fields, and critically a **fresh nonce** — is a brand-new valid transaction and executes the same effect again.

**So it is neither intent nor payload strictly: it is a position in a per-account sequence.** The nonce is a *linearization* device, not a *deduplication* device. ERC-4337 says so itself: *"the sequential transaction nonce value is used as a replay protection method as well as to determine the valid order of transaction being included in blocks."* A counter has no notion of a caller-chosen key and therefore cannot express "this *intent* has already been performed."

**Two transactions, same logical outcome, nonces `N` and `N+1` — both valid, both execute.** The crux: **a monotonic counter cannot distinguish "the user retried" from "the user deliberately did it again," because the observable input is identical (`nonce := current+1`).** Any scheme relying on the counter dedupes *by accident of the client's nonce bookkeeping*, not by an onchain statement of intent.

**The "first attempt landed but the client never saw the receipt" scenario:**

- **(a) Naive retry reusing cached nonce `N`.** Rejected `ErrNonceTooLow`. Deduped — but by the *client's stale cache*, not by any onchain intent record. This is the case producing the widespread-but-incorrect intuition that "the nonce is an idempotency key."
- **(b) Correct retry that re-reads the nonce** (what every production client does — ethers `NonceManager` uses `super.getNonce("pending") + #delta`; viem uses `eth_getTransactionCount` *"as the source of truth"*). Gets `N+1`, builds a fresh tx, **executes again**. Zero protection.
- **(c) `NonceManager.reset()` / fresh process.** Same as (b).
- **(d) JSON-RPC / browser-wallet account.** viem: *"the Wallet or Backend will manage the nonces"* → wallet reads from the node → `N+1` → double execution.

**The nonce "protects" only the retry path already safe by construction (replaying identical bytes) and provides nothing on the retry path that matters (rebuilding after a lost receipt).**

**At-most-once, exactly-once, or neither?** **At-most-once for a specific signed payload** (equivalently a specific `(sender, nonce)` slot) and **no at-most-once guarantee for a logical intent**. Not exactly-once, because a reverted or out-of-gas transaction still consumes the nonce — "executed" and "consumed a nonce" are different events. Summary: *slot-level mutual exclusion, payload-level replay protection, zero intent-level idempotency.*

**Failure modes.** Nonce gap / head-of-line blocking (`ErrNonceTooHigh` stalls every later tx from that account indefinitely — a **liveness** failure a keyed receipt does not have, since independent keys decouple ordering from deduplication); accidental replacement from concurrent sends racing one nonce; stuck nonce requiring a same-nonce higher-fee replacement (you cannot cancel one intent without touching the shared counter all your other intents depend on); nonce exhaustion (EIP-2681); entanglement of all of an account's activity; and client-side drift — ethers' own source admits `// @TODO: Maybe handle interesting/recoverable errors? Like don't increment if the tx was certainly not sent`.

**Contrast with the three alternative shapes.**

**(a) Keyed idempotency receipt (the CommitOnce shape).** A *set of consumed keys*, each chosen by the caller as `(authority, namespace, idempotency key)`, with insert-if-absent / revert-if-present evaluated in the same atomic transaction as the business logic. Properties a counter structurally cannot have: dedupes the **logical intent**; **robust to rebuild** because the key is not a function of tx bytes, blockhash, or signature; **independent per key** (no head-of-line blocking, no cross-intent entanglement); retention is an **explicit policy window**; `namespace` gives multi-tenant isolation. Costs: per-key storage and the retention-policy decision.

**(b) Monotonic counter.** EVM nonce, Cosmos `Sequence`, Aptos `sequence_number`, NEAR access-key nonce, ERC-4337 per-`key` `seq` — one integer per account. Dedupes a *position*; gives ordering and liveness; prevents payload replay. Cannot dedupe intent, because advancing the counter *is* what a retry does.

**(c) Nullifier set.** Structurally the **same data structure** as a keyed receipt (a set of consumed opaque values with insert-if-absent semantics) — so the difference is *provenance and scope*, not mechanism. Tornado Cash: nullifier derived from a secret committed at **deposit** time, so the caller cannot choose the key at use time; app-scoped mapping. Semaphore: `hash(secret, scope)` — genuinely keyed and caller-scoped, but bound to group membership and its verifier. MACI: no onchain dedup at all. **A nullifier set is mechanically generic, but in every deployment verified it is app-scoped.**

### 10.3 Is any of these a generic permissionless onchain idempotency primitive robust to rebuilt transactions?

**Yes — three verified cases:**

1. **EIP-1014 `CREATE2` deploy-to-revert (with EIP-684 collision semantics).** Generic, permissionless, rebuild-robust — the address depends on `(deployer, salt, init_code)`, not tx bytes. Arachnid's proxy and Safe Singleton Factory make the deployer address identical across EVM chains; EIP-6780 makes the receipt permanent post-Cancun. **Caveats:** it is a *deployment* primitive — the receipt is a contract's mere existence, so it costs a contract creation, cannot record a payload or outcome, requires identical `init_code` per key, and the "namespace" is the factory address shared by everyone using it. It answers "has this key been used?" but not "what happened when it was used?"
2. **Cosmos SDK unordered transactions (ADR-070).** Shipped. Keyed by `(signer, client-chosen timeout_timestamp)`; duplicates rejected; pruned in `x/auth` `PreBlocker`. Explicitly independent of tx bytes: *"enforcing single-use unordered nonces, instead of deriving nonces from bytes in the transaction."* **Caveats:** protocol-level tx feature, not a composable primitive; key is a timestamp; 10 min retention cap.
3. **Aptos orderless transactions (AIP-123).** Shipped. Keyed by `(sender address, client-chosen u64 nonce)`; duplicate → `NONCE_ALREADY_USED` *"even with a different expiration time"*; sequence number not incremented. **Caveats:** protocol-level; bare `u64` with no namespace; reuse after GC (~60s + grace).

**Partial / account-gated — worth naming:** **ERC-4337 2D nonce used as `(key = intentHash, seq = 0)`.** Mechanically this *is* a keyed one-shot receipt in EntryPoint storage: `_validateAndUpdateNonce` checks only `nonceSequenceNumber[sender][key]++ == seq` and **never hashes the UserOperation**, so a rebuilt UserOp with the same `(key, seq)` and different calldata is indistinguishable to the EntryPoint, while a second use fails. The spec sanctions arbitrary keys. **But it is gated by the smart account** — the spec's own sequential-nonce recipe is `require(userOp.nonce < type(uint64).max)`, rejecting any non-zero key, and many deployed accounts enforce exactly that. The dedup state also lives in the EntryPoint keyed by `sender`, so there is no cross-account namespace.

**Verified NOT generic idempotency primitives:** EIP-155 `chainId`; EVM account nonce; ethers/viem nonce managers (offchain allocators); the ERC-4337 `seq` counter; NEAR access-key and NEP-366 nonces; Aptos `sequence_number`; Sui object versions; Bitcoin `nSequence`/RBF (a replaceability signal, and per BIP-68 a relative lock-time — **not replay protection at all**); Bitcoin UTXO consumption.

**Bottom line for Target 10.** On EVM and every other chain verified, the mechanisms are either (i) *counters* — payload-level replay protection and ordering but no intent-level dedup; (ii) *app-scoped nullifier sets* — the right shape but not permissionless or cross-application; or (iii) protocol-level transaction-scoped keyed-receipt features (Cosmos, Aptos) plus one generic deployment-scoped guard (`CREATE2` deploy-to-revert). **There is no verified generic, permissionless, composable, *instruction-level* onchain idempotency primitive on EVM** — the closest is `CREATE2` deploy-to-revert, constrained to being a deployment. npm confirms no Solidity library packages this as an idempotency primitive; the absence of a *library* (as opposed to the *mechanism*) is **UNVERIFIED in full**, since GitHub code search requires authentication.

---

## 11. Cross-cutting matrix

| Capability | SDP `Idempotency-Key` | Solana Pay `reference` | Helius Sender | Jito bundles | Triton Cascade | Squads `nonce-guard` | Helium `lazy_transactions` | Light `nullifier-program` | `sol_idempotent` |
|---|---|---|---|---|---|---|---|---|---|
| **Layer** | Backend REST + Postgres | Client URL scheme | RPC/relayer | Validator + block engine | RPC/relayer | Onchain program | Onchain program | **Onchain program** | Onchain program |
| Dedupes identical signed bytes | No (record-level) | No | No | No | No | No | No | No (keyed) | No (keyed) |
| Dedupes backend HTTP requests | **Yes** | No | **No** | **No** | **No** | No | No | No | No |
| Dedupes durable-nonce usage | No | No | No | No | No | **Rejects it entirely** | No | No | No |
| Dedupes **logical intents** | Partially (own records; 409 on rebuild) | No | **No** | **No** | **No** | **No** | Yes (pre-committed leaf) | **YES** | **YES** |
| Robust to rebuilt/re-signed tx | N/A (409s instead) | No | **No** | **No** | **No** | No | **Yes** | **Yes** | **Yes** |
| Prepend-one-instruction UX | No | No | No | No | No | No (wrap/CPI) | No (crank) | **Yes** | **Yes** |
| Arbitrary instruction sets | No | No | Yes | Yes | Yes | Yes (as CPI) | **No** (pre-committed tree) | **Yes** | **Yes** |
| Permissionless | No (API key) | Yes | Yes | Yes | Yes | Yes | **No** (authority) | **Yes** | Yes |
| Authority scoping of keys | Per org/project | N/A | N/A | N/A | N/A | Per owner PDA | Per tree authority | **NO (griefable)** | Owner-scoped map |
| Namespace field | Per domain | No | N/A | N/A | N/A | No | Per tree name | **NO** | **NO** |
| Self-contained (no RPC/prover) | N/A | Yes | N/A | Yes | N/A | **Yes** | Yes | **NO (proof fetch)** | Yes |
| Explicit retention window | No TTL (record lifetime) | N/A | N/A | N/A | N/A | N/A | No (permanent bits) | No | No |
| Maintenance | Active (2026-09-19) | Stable/repurposed | Active (2026-09-17) | Validator active; SDKs dormant | Active (2026-09-17) | v0.1.0, single commit (2026-06-16) | Active (2026-09-15) | Reference impl., unaudited, 71 dl | **Abandoned (2023)** |

---

## 12. VERDICT — the critical question, answered without softening

> **Does any currently maintained production product already provide a GENERIC, PERMISSIONLESS, COMPOSABLE onchain idempotency key for ARBITRARY Solana transaction instruction sets, with essentially the same developer UX (prepend one guard instruction to your existing transaction) and essentially the same invariant (at-most-once execution of a logical intent within a retention window, robust to rebuilt/re-signed retries)?**

### Answer: **YES — one does. Light Protocol's `nullifier-program`. The "nobody has built this" claim is false.**

I verified it three independent ways in this session, and I want to be precise about how strong the evidence is:

- **Official documentation** states the use case and the mechanism in CommitOnce's own terms: *"you might want to prevent your on chain instruction from being executed more than once… derives PDA from `["nullifier", id]` seeds… If the address exists, the whole transaction fails… **Prepend or append this instruction to your transaction.**"* — https://www.zkcompression.com/compressed-pdas/nullifier-pda
- **Program source** confirms the seeds and the abort-on-exists semantics: `derive_address(&[b"nullifier", &id], &address_tree_pubkey, &crate::ID)`.
- **Live RPC `getAccountInfo`** confirms it is deployed and executable on **both mainnet-beta and devnet** at `NFLx5WGPrTHHvdRNsidcrNcLxRruMC92E4yv7zhZBoT`.

Its invariant is **the same as CommitOnce's**: a prependable guard in the same atomic transaction, a deterministic PDA receipt keyed by a caller-chosen identifier, whole-transaction abort if the receipt exists, and — because the receipt is onchain state rather than derived from transaction bytes — **robustness to a rebuilt transaction with a new blockhash and a different signature.** A second, weaker instance exists (`sol_idempotent`, mainnet-live, RPC-verified) but is abandoned and keyed by a bare `u32` bit index.

### But "YES" is not the end of the answer, because it is **not a production product** and it is **materially different in the two ways that matter most**

**It is not a production product.** It is a **reference implementation** published on a ZK-compression documentation site. The doc says so explicitly: *"Note that this is a reference implementation. Feel free to fork the program as you see fit."* Its README says: *"The nullifier program code is **unaudited**, use at your own risk."* Adoption is **71 crate downloads** and an npm package last published 2026-02-05. There is no vendor, no product surface, no dashboard, no support, no SLA, and no retention-window policy. And the parent project's own docs banner reads **"Light is joining Helius"** — a continuity risk. Calling this "a currently maintained production product" would be a stretch; calling it "a documented, deployed, permissionless primitive with negligible adoption" is accurate.

**The two material differences — and these are the real competitive surface:**

1. **No authority scoping → it is griefable and front-runnable.** The PDA seeds are `["nullifier", id]`. **The signer is not in the seeds.** The accounts struct is literally `GenericAnchorAccounts { #[account(mut)] signer: Signer }` — a fee payer, not a namespace component. **Anyone who learns or predicts an `id` can consume it first and permanently block the legitimate user's transaction.** CommitOnce's `(authority, namespace, idempotency key)` keying closes this *by construction*; Light's design leaves it to the caller to remember to hash their own pubkey into `id`, and does not enforce it. For an idempotency primitive this is not a cosmetic gap — an adversary-triggerable permanent denial of a legitimate intent is a denial-of-service on the exact guarantee being sold.

2. **It is not self-contained — it requires an RPC.** Building the guard instruction requires **fetching a Light Protocol validity proof** from a prover/indexer (`fetch_proof`; the official examples construct a `LightClient` with an explicit `photon_url` and a **Helius API key**). CommitOnce's stated positioning is "**NOT an RPC**." Light's primitive **is** RPC-dependent, and the receipt is a *compressed* account (~15,000 lamports) backed by Light's state trees and its System Program, under an **upgradeable** program with an upgrade authority.

Plus: **no namespace field** (single opaque 32-byte `id`), **no retention window** (permanent by default, and whether it could be un-spent is UNVERIFIED), and **no productized developer UX** — no SDK wrapping it as an idempotency key, no observability, no key-management story.

### So what is actually novel, and what is not

**Not novel (established prior art, do not claim otherwise):**
- The **mechanism**: keyed PDA receipt + abort-if-exists + same-atomic-transaction. This is the canonical Solana `init`-constraint idiom, used in production by countless app programs, and **productized as a generic permissionless program by Light Protocol** (mainnet-live) and previously by `sol_idempotent` (mainnet-live, abandoned).
- The **UX shape**: *"prepend a tiny generic guard program to your existing transaction and let atomicity do the work"* is **already deployed, generic, permissionless, and verifiable-built on mainnet** — `p-never-nonce` (`pnn1ctaR1tbP7EGrcz3WtrJKknRxKmKqADztKY9C3YJ`, Apache-2.0, three integration modes including CPI) and `solana-asm/shield` (seven deployed guard programs). The ecosystem has already accepted this pattern. The *only* difference is the **invariant being guarded**: nonces/deadlines/slippage, never *duplicate intent*.
- The **onchain receipt/commit-marker pattern**: Helium's `lazy_transactions` ships a real at-most-once marker (a bitmap plus a legacy `Block` PDA documented as *"Empty account that blocks tx from going through more than once"*), rebuild-robust, in production for the HNT migration — but authority-gated, keyed by a pre-committed Merkle leaf index, and with no retention window.

**Genuinely open (the defensible gap):**
- **Authority-scoped keys**: `(authority, namespace, key)` as first-class, protocol-enforced seed components, so a key cannot be griefed by a third party. **No verified Solana primitive does this.**
- **Self-containment**: a guard with **no RPC, prover, indexer, or API-key dependency** — buildable offline from the key alone. Light's requires a proof fetch; that is a hard architectural difference, not a detail.
- **Productization**: an explicit, configurable **retention window**; a documented security model; observability (which keys are spent, by whom, when); an audited, stable, versioned program with a support surface.
- **A stated, tested invariant**: "at-most-once **successful** execution of a logical intent" — note that because Solana reverts the entire transaction on any instruction failure, a guard that *creates* the receipt (rather than merely checking it) correctly yields at-most-once for *successful* execution. Light's program does create-and-fail, so its invariant is the same; but nobody documents or tests it as a product guarantee.

### The honest one-paragraph summary

The claim "**no currently maintained production product provides a generic, permissionless, composable onchain idempotency key for arbitrary Solana instruction sets**" is **FALSE as of September 2026**. Light Protocol's `nullifier-program` does exactly that, is documented in CommitOnce's own terms, and is live on mainnet and devnet — I confirmed all three facts from primary sources. It is, however, a **reference implementation, explicitly unaudited, with ~71 downloads and no product around it**, and it is **materially weaker than CommitOnce in two respects that matter**: its receipt is **not authority-scoped** (so any third party who learns an `id` can permanently burn it, denying the legitimate intent) and it is **not self-contained** (it requires a Light validity proof fetched from an RPC/indexer, whereas CommitOnce's premise is "not an RPC"). It also has no namespace, no retention window, and no productized UX. **Therefore CommitOnce is not novel in mechanism — it must engage `NFLx5WGPrTHHvdRNsidcrNcLxRruMC92E4yv7zhZBoT` head-on and never claim to be first — but the productized, authority-scoped, RPC-independent, retention-windowed version of this primitive does not exist.** That is a real and defensible gap; it is a **narrower** gap than "nobody has thought of this," and any pitch that ignores Light's program is misrepresenting the landscape.

---

## Appendix — consolidated UNVERIFIED items

- That Jito *documents* "a bundle containing an already-landed transaction is rejected" — no verbatim statement found; conclusion inferred from `bundle.proto`'s `PartiallyProcessed` + Solana's `AlreadyProcessed`.
- The full algorithm of Jito "revert protection" beyond `bundleOnly=true`.
- Whether Light's nullifier marker could ever be un-spent via a Light-system-level `close`/`reinit` or a program upgrade.
- Colosseum hackathon archives — client-rendered SPA, no reachable public API; **not exhaustively searched**.
- GitHub **code** search (requires auth) — so "no code implements X" rests on repo-name/description search plus registry search, not exhaustive code grep.
- Meteora/Jupiter/Kamino position PDAs — asserted from architecture, not individually fetched.
- web3.js nonce-management internals — tree API was rate-limited (403) during the subagent's run.
