# CommitOnce — technical overview

For a technical judge. This document covers the mechanism, the design decisions behind it, the
byte-level layouts, the measured cost, and the boundaries of the guarantee.

**Status: unaudited.** Live on devnet. Not deployed to mainnet. Not published to npm. Every
number below is reproducible from the repository; the recorded evidence is
[`EVIDENCE.md`](../EVIDENCE.md), which is the authority on what is and is not verified.

---

## 1. Positioning first: what is and is not new

Stated up front, because a judge will find the prior art anyway and because the honest framing
is the defensible one.

**Not new.** The receipt-PDA-abort-if-exists mechanism is old and widely used: Light Protocol's
`nullifier-program`, `sol_idempotent`, Helium's `lazy_transactions` block marker, and Anchor's
own `init` constraint all implement it. The "prepend a tiny generic guard program and let
atomicity do the work" developer experience is also already deployed (`solana-asm/shield`,
`p-never-nonce`). This project does not claim either as an invention.

**What is new here** is the combination, and specifically the security model:

| | Light `nullifier-program` | CommitOnce |
| --- | --- | --- |
| Receipt seeds | `["nullifier", id]` — **no signer** | authority-scoped, enforced by the program's `seeds` constraint |
| Griefing | anyone who learns an id can consume it and permanently block the legitimate intent | a third party derives a *different* address and cannot block anything |
| Dependencies | requires an RPC/prover round trip (`create_nullifier_ix(rpc, …)`, `fetch_proof`) | self-contained; derivation is local and pure |
| Storage | compressed accounts, Light state trees, upgradeable, ~15,000 lamports | plain 202-byte program-owned PDA, 1,676,400 lamports, refundable |
| Namespaces | none | first-class |
| Retention | none | explicit, bounded, with dual expiry gates and permissionless refund |
| Assurance | README: *"unaudited, use at your own risk"* | also unaudited — stated everywhere, not hidden |

Adoption of the Light program is negligible (71 crate downloads; its npm package last published
2026-02-05), but that is a market observation and not a technical argument. The technical
differences above are the reason this project was not stopped by its own kill condition. Full
survey with primary sources: [`docs/PRIOR_ART.md`](../docs/PRIOR_ART.md).

---

## 2. The problem, in runtime terms

Solana's runtime deduplicates transactions by **message hash**. Agave's `runtime/src/bank.rs`
states the purpose verbatim: the message hash is added to the status cache *"to ensure that this
message won't be processed again with a different signature."*

The protection is **content-addressed**: it protects *signed bytes*. It does not protect a
*logical intent*. A rebuilt transaction — fresh blockhash, different priority fee, different
route, re-signed — is different bytes, therefore a different message hash, therefore a new
object to the runtime. Both can land.

Solana documents the gap and assigns the remedy to the application:

> *"A rebuilt transaction has a new signature, so preserve application-level idempotency before
> sending it."* — <https://solana.com/docs/tools/production-readiness>

The same page adds that *"a `null` result from the recent signature-status cache is
inconclusive"* — so even *asking* whether the first attempt landed is not reliable. The
official guidance names both halves of the problem and then hands it to the caller. That
assignment is the gap CommitOnce fills.

| Layer | Keys on | Protects against | Does not protect against |
| --- | --- | --- | --- |
| Runtime status cache | message hash (bytes) | the identical transaction re-submitted | any rebuild |
| CommitOnce receipt | `(authority, namespace, key)` in chain state | a rebuilt transaction for the same intent | a *different* intent, or an unguarded code path |

The two layers are complementary. CommitOnce does not replace or interfere with runtime
deduplication: `identical_rebroadcast_still_rejected_by_the_runtime` asserts that a
byte-identical rebroadcast is still rejected by the status cache.

---

## 3. The mechanism

One instruction, prepended to the transaction the caller already builds:

```text
one atomic Solana transaction
  1. commit_once::claim(namespace_hash, idempotency_key_hash, payload_hash,
                        retention_seconds, refund_destination)
       receipt PDA absent  -> create it (invoke_signed), emit IntentCommitted, continue
       receipt PDA present -> ERROR -> the whole transaction reverts
  2. ...your existing business instructions...
```

The downstream program is not modified, does not import CommitOnce, and does not know it
exists. That is what makes the guard composable: `programs/demo-counter` in this repository is
deliberately a program that knows nothing about CommitOnce, and the guarded path produces
identical business state (`guard_is_transparent_to_the_business_instructions`).

### The guarantee, stated exactly

> For one `(authority, namespace, idempotency key)` tuple, **no more than one guarded transaction
> may successfully commit during the receipt retention period.**

That is **at-most-once successful execution of a guarded logical intent within the configured
retention window.** Three words in that sentence are load-bearing and are never dropped: *at most
once*, *guarded*, and *within the retention period*. It is not a claim of universal "exactly once"
execution — CommitOnce prevents a second execution, it does not make the first one happen, and
retrying until success remains the caller's job. Combined, the two give exactly-once-style
application semantics.

---

## 4. Receipt PDA derivation

```text
receipt PDA = find_program_address(
    seeds = [
        b"commit-once",        // 11 bytes — domain prefix (RECEIPT_SEED)
        authority,             // 32 bytes — the signing authority
        namespace_hash,        // 32 bytes — sha256("commitonce/namespace/v1" || namespace)
        idempotency_key_hash,  // 32 bytes — sha256("commitonce/key/v1" || idempotency_key)
    ],
    program_id = CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB,
)
```

Every seed is a fixed size (11 / 32 / 32 / 32), so arbitrary-length namespace and key strings
never enter the seeds directly. That avoids the 32-byte-per-seed limit and makes the derivation
a single definition that can be pinned across languages.

**Hashing happens client-side.** The program treats both hashes as opaque 32-byte values. That
keeps instruction data fixed-size, keeps unbounded strings out of PDA seeds, and lets the
derivation be tested in three independent places:

| Implementation | Where | How it is pinned |
| --- | --- | --- |
| Rust program-side expectation | `programs/commit-once/tests/wire_format.rs` | golden hex vectors |
| TypeScript SDK | `packages/sdk/test/vectors.test.ts` | the same golden hex vectors |
| Independent recomputation | `packages/sdk/scripts/print-vectors.mjs` | recomputed from `@solana/kit` primitives **without importing the SDK** |

The third one matters: the two suites cannot agree by construction, because the vectors are
recomputed by an implementation that does not share code with the SDK. Three implementations
agreeing is a much stronger signal than one suite agreeing with itself.

**Domain separation.** `commitonce/namespace/v1` and `commitonce/key/v1` are distinct prefixes,
so a namespace hash can never equal a key hash. An application cannot shadow another's key
space by choosing a colliding string, and `same_textual_key_under_different_namespaces_does_not_collide`
asserts it.

Pinned values (from `docs/API_REFERENCE.md` §11, asserted by the tests above):

| Input | Value |
| --- | --- |
| `sha256("global:claim")[0..8]` | `3ec6d6c1d59f6cd2` |
| `sha256("global:close_receipt")[0..8]` | `7efef4cb7ca48659` |
| `sha256("account:IntentReceipt")[0..8]` | `54fc5d647e500f86` |
| `namespaceHash("payments:transfer")` | `9e7bb3a4dce399c675e567cec2312197966a9dd8ab00b93834b82ead8a49cde3` |
| `idempotencyKeyHash("order_928")` | `0a9ba9a57e3b998c5807159e02e362f2d14c85cfe02e5b508e7f2cfd2d3d4e0d` |
| Receipt PDA for authority `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`, namespace `payments:transfer`, key `order_928` | `654vyv9LHwgAgn2rceouNQj8GXwiatAseFZAKCPPSTYV` (bump 255) |

---

## 5. Why the authority is in the seeds (the griefing argument)

This is the single most important design decision, and it is the one the product is actually
differentiated on.

Consider an onchain "have I done this already?" guard whose receipt address depends only on an
identifier: `PDA(["guard", id])`. The identifier has to come from somewhere — an order id, an
invoice number, a `uuid`, a hash. All of those are *guessable or learnable*. Anyone who can
learn or predict the identifier can claim it first. The legitimate claim then fails forever,
because the receipt exists and there is no cleanup. A payment is blocked, permanently, at a
cost to the attacker of one transaction fee.

That is not a theoretical weakness; it is a denial-of-service primitive that turns a safety
feature into an attack surface, and it is why an un-scoped generic guard is hard to ship as
infrastructure.

CommitOnce puts the authority in the derivation:

```text
seeds = [b"commit-once", authority, namespace_hash, idempotency_key_hash]
```

An attacker who knows the victim's namespace and key derives a **different address**. Their
claim lands on their own receipt and leaves the victim's key untouched. Crucially, the property
is enforced by the program's `seeds` constraint rather than left to callers to remember — a
caller cannot forget to scope their key, because the scoping is not the caller's job.

This is asserted end-to-end by `third_party_cannot_consume_another_authoritys_key`: an attacker
front-runs with the victim's exact namespace and key, and the victim's subsequent claim still
succeeds. `receipt_pda_cannot_be_substituted_across_authorities` asserts the same binding from
the other direction, and `same_textual_key_under_different_authorities_does_not_collide`
asserts the key-space separation.

**Honest caveat.** This is not a claim that a design without authority-scoped seeds is *wrong* —
a caller can hash their own pubkey into the identifier and recover the property. The claim is
narrower and checkable: *the protocol does not enforce it*, and a security property that depends
on every integrator remembering it is not a property the primitive can advertise.

---

## 6. Atomicity properties

Because the guard and the business instructions are in the same Solana transaction, two
properties hold without any additional machinery:

**1. A receipt cannot exist without its action having committed.** If any later instruction
fails, the whole transaction — receipt creation included — is rolled back. There is no state in
which a receipt exists but the business action did not happen, so a failed attempt stays
retryable instead of being permanently poisoned. The rent transfer is rolled back with it, so
only the transaction fee is spent.
*Test:* `downstream_failure_rolls_back_the_receipt`.

**2. A blocked duplicate cannot partially execute.** When `claim` returns an error, the error
fails the transaction, so the business instructions after it never run. A blocked duplicate
therefore cannot leave the system half-updated.
*Test:* `with_guard_rebuilt_retry_is_blocked_and_business_action_runs_once`.

Both properties are asserted against observable onchain state — counter values, account
existence, lamport balances, PDA addresses — never against an error string. No test in the
suite asserts on message text, because message text is not a stable contract.

**The A/B pair is the core evidence:**

```rust
// Two genuinely rebuilt transactions — fresh blockhash, different priority fee —
// so the runtime's message-hash dedup cannot help.
let attempt_1 = env.send_distinct(&[claim, increment], 1);
let attempt_2 = env.send_distinct(&[claim, increment], 2);

assert_success(&attempt_1);
assert_custom_error(&attempt_2, E_ALREADY_COMMITTED);
assert_eq!(env.counter_value(&authority), 1);   // the business action ran once
```

and the same scenario without the guard, which demonstrates the bug:

```rust
// without_guard_two_rebuilt_transactions_execute_twice
assert_eq!(env.counter_value(&authority), 2);   // the duplicate landed
```

---

## 7. Payload fingerprint rules

The receipt stores a 32-byte `payload_hash`. Reusing a key with a **different** fingerprint is
reported as `IdempotencyConflict` (6001) rather than silently treated as a duplicate. So
`order_928` for 10 USDC and `order_928` for 100 USDC are distinguishable, and the second fails
loudly instead of quietly returning the first one's outcome and dropping a real payment.

The fingerprint defines "the same intent". Getting it wrong is the most likely way for an
integrator to weaken the guarantee, so the rules are explicit:

| Include — everything that makes the action what it is | Never include — anything that changes when a transaction is rebuilt |
| --- | --- |
| recipient, amount, mint | blockhash |
| memo, order id, chain id | signature |
| program ids being invoked | priority fee, compute budget |
| | retry count, attempt id |
| | submission route, RPC URL |

Including any transport detail would make a retry look like a *different* intent: the guard
would raise `IdempotencyConflict` instead of `AlreadyCommitted`, and — far worse — a rebuilt
retry would be treated as a brand-new action and execute a second time. That would defeat the
entire product, which is why the rule is stated in the SDK's own doc comments and repeated in
`docs/SECURITY_MODEL.md` §5.

The SDK's `encodeIntent` produces a deterministic, injective, length-prefixed encoding
(`<tag><length>:<payload>`) with object keys sorted, so insertion order cannot change the
result. It **throws** on `undefined` rather than dropping the property the way `JSON.stringify`
does, because a silently dropped property could make two genuinely different intents encode
identically and hide a conflict. It also rejects `Date`, `Map`, `Set` and non-finite numbers for
the same reason. Callers who need a synchronous path or their own hashing implementation can
pass a precomputed 32-byte fingerprint directly.

---

## 8. Retention and the dual expiry gates

`claim` takes `retention_seconds: u64`:

| Value | Meaning |
| --- | --- |
| `0` | **permanent** — never expires, can never be closed |
| `3600 … 31_536_000` | 1 hour … 365 days |
| anything else | rejected with `InvalidRetention` (6003) |

The receipt records **two** deadlines:

| Deadline | Source | Property |
| --- | --- | --- |
| `expires_at_slot` | `created_slot + retention * SLOTS_PER_SECOND` | monotonic; not validator-manipulable |
| `expires_at_unix_ts` | `created_unix_ts + retention` | keeps the *advertised* retention honest if slots run faster than assumed |

`close_receipt` requires **both** gates to have passed. The asymmetry is deliberate and is the
whole point of having two: because the gates are combined with AND, a change in slot timing can
only ever **delay** cleanup — the receipt lives longer than advertised, which is safe — and
never **accelerate** it into a window where a still-valid signed duplicate could execute.

`SLOTS_PER_SECOND` is `4`, matching mainnet's 250 ms slots since epoch 1036, not the historical
400 ms target. Underestimating it would silently shorten the advertised window; overestimating
it would make the slot gate the binding constraint and delay cleanup. Under either error the
failure mode is a delayed cleanup, never a premature one.
*Test:* `slot_deadline_uses_current_mainnet_slot_rate`.

**Why one hour is the floor.** A signed transaction built on a recent blockhash is executable
for roughly 38 seconds at 250 ms slots. `MIN_RETENTION_SECONDS` is one hour — roughly 95× that
window — so there is no accepted configuration in which cleanup can outrun a live duplicate.
*Test:* `retention_below_minimum_is_rejected`, `retention_above_maximum_is_rejected`,
`retention_boundaries_are_accepted`.

**Cleanup is permissionless and cannot steal.** `close_receipt` refunds the deposit to the
`refund_destination` recorded at claim time, and the account is constrained with
`address = receipt.refund_destination`, so the program refuses any other destination. Anyone may
therefore submit the cleanup transaction and pay its fee while the deposit always returns to the
configured account: cleanup does not require the authority to be online, and cannot be used to
redirect funds.
*Tests:* `close_returns_rent_deposit_to_the_configured_destination`,
`close_requires_the_configured_refund_destination`, `receipt_cannot_be_closed_before_expiry`
(which checks each gate in isolation).

**Closing reopens the key — deliberately.** Once a receipt is closed, the same
`(authority, namespace, key)` can be claimed again. This is the documented cost of a bounded
window, not an oversight. It is why the guarantee is stated as "within the retention period",
and it is asserted by `closing_frees_the_key_for_a_new_claim` so it cannot be forgotten. Choose
a retention that exceeds your maximum retry horizon; if a client might retry after a week, a
one-hour retention is wrong.

**Why cleanup exists at all.** Without it, every receipt would be permanent, and a payment
processor issuing a million intents would lock roughly 1,676 SOL in rent forever. Cleanup is
what makes the primitive economically usable at volume.

---

## 9. Durable-nonce policy

A durable-nonce transaction never expires, so an old signed duplicate stays executable
*forever*. If its receipt could be cleaned up, cleanup would reopen the duplicate window
permanently and silently break the guarantee.

So `claim` inspects the Instructions sysvar for a System Program `AdvanceNonceAccount`
instruction (discriminator `u32` LE `4`, scanning at most `MAX_INSTRUCTION_SCAN = 128`
instructions) and **rejects the transaction with `DurableNonceUnsupported` (6002) unless
`retention_seconds == 0`.** Permanent receipts have no cleanup path, so they are safe to combine
with nonces and are explicitly supported.

**The scan fails closed.** Running out of budget returns `InstructionScanInconclusive` (6011)
rather than assuming the transaction is nonce-free, because assuming that would let a caller hide
a real nonce past the bound by padding the transaction and so obtain a finite receipt on a
transaction that never expires. In practice the bound cannot be reached — the SVM caps a
transaction at its own instruction ceiling, which
`scan_bound_sits_above_the_runtime_instruction_ceiling` discovers by probing rather than
hardcoding — but the bound is asserted to stay above that ceiling, because a constant owned by
another codebase is exactly the kind of thing that changes without warning.

The conceptual technique — rejecting nonce transactions by inspecting the instructions sysvar —
is borrowed from Squads' `nonce-guard`, which inspects the same sysvar for the same reason.
That program deduplicates nothing (its PDA is per-owner, not per-intent), but it demonstrates
that the introspection works. The implementation here is independent; no code is vendored.

*Tests:* `durable_nonce_transaction_is_rejected_for_finite_retention`,
`durable_nonce_transaction_is_allowed_for_permanent_retention`, and
`ordinary_transactions_are_not_mistaken_for_nonce_transactions` — the last one guards against an
over-eager check that would break every normal integration.

**A limitation stated rather than hidden:** a *genuine* durable-nonce transaction cannot be
expressed in LiteSVM 0.10.0, because LiteSVM passes the transaction's own blockhash into the
program environment, making the System Program's advance check and the runtime's nonce
validation mutually exclusive. The tests therefore assert the program's stricter behaviour —
that the *presence* of the marker triggers the policy — in both directions, and the limitation
is documented at length in `programs/commit-once/tests/security.rs`.

---

## 10. Account and data layouts

### 10.1 `claim` accounts — four, in this order

The order is load-bearing: the receipt's seeds reference `authority`, so `authority` must be
declared first.

| # | Account | Signer | Writable | Constraint | Purpose |
| --- | --- | --- | --- | --- | --- |
| 0 | `authority` | yes | yes | — | The intent authority. Pays the rent deposit. Bound into the PDA seeds. |
| 1 | `receipt` | no | yes | PDA, `seeds = [b"commit-once", authority, namespace_hash, idempotency_key_hash]`, canonical bump | The receipt. Created when absent. Declared unchecked; ownership, discriminator and contents are verified in the handler before any pre-existing account is trusted. |
| 2 | `instructions_sysvar` | no | no | `Sysvar1nstructions1111111111111111111111111` | Read for durable-nonce detection. |
| 3 | `system_program` | no | no | `11111111111111111111111111111111` | Used only to create the receipt. |

The authority is the rent payer rather than a separate sponsor account, which removes one
account from every guarded transaction. A relayer can still pay the transaction *fee*: the fee
payer and the authority are independent roles.

### 10.2 `claim` instruction data — 144 bytes, Borsh, little-endian

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 8 | discriminator `sha256("global:claim")[0..8]` = `3ec6d6c1d59f6cd2` |
| 8 | 32 | `namespace_hash` |
| 40 | 32 | `idempotency_key_hash` |
| 72 | 32 | `payload_hash` |
| 104 | 8 | `retention_seconds` (`u64` LE) |
| 112 | 32 | `refund_destination` |
| **144** | | **total** |

The SDK builds these bytes by hand rather than through a generated client, so the wire format is
auditable in one place and the package stays dependency-free.

### 10.3 `IntentReceipt` — 202 bytes, versioned

| Offset | Size | Field | Notes |
| --- | --- | --- | --- |
| 0 | 8 | discriminator | `sha256("account:IntentReceipt")[0..8]` = `54fc5d647e500f86` |
| 8 | 1 | `version` | `1`; `0` is reserved as "not a receipt" |
| 9 | 1 | `bump` | canonical PDA bump |
| 10 | 32 | `authority` | also bound through the PDA seeds |
| 42 | 32 | `namespace_hash` | as supplied to `claim` |
| 74 | 32 | `idempotency_key_hash` | as supplied to `claim` |
| 106 | 32 | `payload_hash` | immutable after creation |
| 138 | 32 | `refund_destination` | immutable |
| 170 | 8 | `created_slot` | `u64` LE |
| 178 | 8 | `expires_at_slot` | `u64` LE, **`0` = permanent** |
| 186 | 8 | `created_unix_ts` | `i64` LE |
| 194 | 8 | `expires_at_unix_ts` | `i64` LE, **`0` = permanent** |

The layout is fixed-size and versioned so indexers and the SDK can decode it without an IDL
round trip. `packages/sdk/src/accounts.ts` decodes it with a documented offset table; both test
suites pin the size and the offsets (`receipt_account_layout_is_exactly_202_bytes`).

`RECEIPT_VERSION` exists because **receipts survive a program upgrade**: a redeploy does not
clear existing receipt PDAs, so an upgraded program will still see receipts written by the
previous version. The handler rejects an unrecognised version with `UnsupportedReceiptVersion`
(6008) rather than guessing at the bytes.

### 10.4 `close_receipt` — two accounts, 8 bytes of data

| # | Account | Writable | Constraint |
| --- | --- | --- | --- |
| 0 | `receipt` | yes | `Account<'info, IntentReceipt>`; closed with `close = refund_destination` |
| 1 | `refund_destination` | yes | `address = receipt.refund_destination` |

### 10.5 Events

| Event | Fields |
| --- | --- |
| `IntentCommitted` | `authority`, `namespace_hash`, `idempotency_key_hash`, `payload_hash`, `refund_destination`, `created_slot`, `expires_at_slot`, `created_unix_ts`, `expires_at_unix_ts` |
| `IntentReceiptClosed` | `authority`, `namespace_hash`, `idempotency_key_hash`, `payload_hash`, `closed_slot` |

`IntentCommitted` is emitted once per receipt — it is the event to count for "how many guarded
intents committed". Neither event is emitted for a blocked duplicate: `claim` logs a message and
returns an error, and the transaction's logs are all that remains.

---

## 11. Evaluation order and error codes

Checks run in this order, and the first failing check is the error the caller sees — which
matters when debugging a rejected transaction.

| Step | Condition | Error |
| --- | --- | --- |
| 1 | retention is not `0` and not in `[3600, 31536000]` | `InvalidRetention` (6003) |
| 2 | `refund_destination == Pubkey::default()` | `InvalidRefundDestination` (6004) |
| 3 | `refund_destination == receipt PDA` | `InvalidRefundDestination` (6004) |
| 4 | retention is finite **and** the transaction contains `AdvanceNonceAccount` | `DurableNonceUnsupported` (6002) |
| 5 | receipt does not exist | *(no error — created, transaction continues)* |
| 6 | an account exists at the PDA but is not owned by this program | `InvalidReceiptOwner` (6005) |
| 7 | data does not deserialise as an `IntentReceipt` | Anchor `AccountDidNotDeserialize` |
| 8 | stored `version != 1` | `UnsupportedReceiptVersion` (6008) |
| 9 | stored `authority` differs from the signing authority | `InvalidReceiptAuthority` (6007) |
| 10 | stored `namespace_hash` or `idempotency_key_hash` differs | `InvalidReceiptData` (6006) |
| 11 | stored `payload_hash ==` instruction's | `AlreadyCommitted` (6000) |
| 12 | stored `payload_hash !=` instruction's | `IdempotencyConflict` (6001) |

The design decision that carries this table: **`init_if_needed` was rejected.** It cannot
distinguish "I just created this" from "this already existed", and that distinction *is* the
entire semantic of `claim`. A guard built on `init_if_needed` would silently become an upsert
and deduplicate nothing. So `claim` declares the receipt as an `UncheckedAccount` with a
`seeds`/`bump` constraint and verifies ownership, discriminator and contents manually before
trusting a pre-existing account.

| Code | Name | What a caller should do |
| --- | --- | --- |
| 6000 | `AlreadyCommitted` | Treat as **success**: the intent already committed. Do not retry; do not surface an error to the user. This is the expected, non-exceptional outcome of a retry. |
| 6001 | `IdempotencyConflict` | **Hard failure.** The key was reused for a different action. Do not retry; alert and investigate. The stored fingerprint is not overwritten. |
| 6002 | `DurableNonceUnsupported` | Use `retention: 'permanent'`, or drop the durable nonce. |
| 6003 | `InvalidRetention` | Fix the retention value. The SDK rejects this before sending. |
| 6004 | `InvalidRefundDestination` | Use a real account that is not the receipt. |
| 6005 | `InvalidReceiptOwner` | Do not proceed; investigate. |
| 6006 | `InvalidReceiptData` | Integrity failure; should be unreachable given the seeds. |
| 6007 | `InvalidReceiptAuthority` | Integrity failure; should be unreachable given the seeds. |
| 6008 | `UnsupportedReceiptVersion` | The receipt was written by an incompatible program version. |
| 6009 | `ReceiptNotExpired` | Wait; the receipt is untouched. |
| 6010 | `ReceiptIsPermanent` | Nothing to do; a permanent receipt can never be closed. |

The SDK exports `classifyError`, `isAlreadyCommitted` and `isIdempotencyConflict`, which walk
both the structured error shapes RPC clients produce and the message-string form
(`custom program error: 0x1770`), because clients routinely surface the program error only as
text. Parse the code, not the log string.

---

## 12. Measured overhead

Every figure below comes from executing the real compiled program, not from estimation.
Reproduce with `bash scripts/test.sh --test benchmarks -- --nocapture`.

The structural numbers are exact and deterministic. The compute-unit figures are **not**:
they vary from run to run on both the cluster and the in-process harness, so they are given as
a range, and the top of the range is what to budget against.

| | Business action alone | With the guard | Delta |
| --- | --- | --- | --- |
| Transaction size (legacy) — exact | 273 bytes | 677 bytes | **+404 bytes** |
| Accounts — exact | 3 | 7 | **+4** |
| Compute units — observed range | 4,067 – 10,067 | 12,404 – 22,904 | **+8,337 – +12,837** |

| Operation | Compute units (range) | Median |
| --- | --- | --- |
| `claim` alone | 7,783 – 12,283 | 9,283 |
| `claim` + business action | 12,404 – 22,904 | 15,404 |
| Duplicate blocked (rebuilt retry) | 8,053 – 11,053 | 8,053 |
| `close_receipt` (cleanup) | 2,701 – 2,701 | 2,701 |

| Receipt account — exact | |
| --- | --- |
| Data length | 202 bytes |
| Rent deposit | 1,676,400 lamports (0.0016764 SOL) |
| `claim` instruction data | 144 bytes |
| `claim` accounts | 4 |

**The same operation on devnet**, from the recorded demo run:

| Operation | Compute units reported by the cluster |
| --- | --- |
| `claim` (succeeded) | 14,669 |
| `claim` (blocked a duplicate) | 13,977 |
| Business increment | 4,067 and 7,067 in the same run |

**Provenance of each number, stated precisely.**

- **Measured, exact**: the receipt data length, the deposit, and the `claim` instruction size
  and account count. These are read from the account store or the instruction itself and are
  identical on every run, so the benchmark asserts them exactly.
- **Measured, non-deterministic**: all compute-unit figures. LiteSVM's compute accounting is not
  reproducible run to run — the same unmodified test binary running the same byte-identical
  `.so` reported a bare counter increment at 5,567, 7,067 and 19,067 CU across three
  consecutive runs. The figures above are a min/median/max over 9 independent environments, and
  the cluster's own figures are given separately because they differ from the harness's.
  Quoting a single compute-unit value would be fabricated precision that a reader could not
  reproduce.
- **Computed**: transaction wire size. LiteSVM does not report serialized size, so it is
  computed from the legacy message wire format by `legacy_wire_size()` in
  `programs/commit-once/tests/benchmarks.rs`. The formula is written out in full so it can be
  checked by hand. The +404-byte delta decomposes exactly as 128 bytes of added account keys
  (4 × 32) plus a 276-byte instruction, and both components were verified arithmetically.

**Context that keeps the numbers honest.**

- **The structural numbers carry the claim; the compute numbers do not.** +404 bytes and +4
  accounts are exact. The compute-unit range is wide, and the range is the honest presentation.
- Budget against the top of the range: ~23,000 CU for a guarded transaction, about 11% of the
  200,000 CU default budget and well under the 400,000 CU limit the demo transactions were
  granted on devnet.
- The baseline is a trivial counter increment, so on a real business action the *relative* cost
  is much lower, and it falls as the guarded action grows.
- The +4 accounts are the receipt PDA, the Instructions sysvar, the System program and the
  CommitOnce program id. In a typical transaction the System program is already present, so it
  is usually **+3**.
- The deposit is fully refunded by `close_receipt`; only the cleanup transaction fee is spent.
- Rent is **5080 lamports/byte** at mainnet rates since SIMD-0437 step 2:
  `(202 data bytes + 128 account overhead) × 5080 = 1,676,400`. The `solana-rent` Rust crate
  still ships an effective 6960 lamports/byte, so any estimate derived from it is **37% too
  high** — the test harness overrides the Rent sysvar to the real value so these figures are
  accurate.
- Compute units have **not** been measured on mainnet. And the in-process harness does **not**
  match the runtime: devnet reported `claim` at 14,669 CU against the harness's 9,283 median, so
  the harness is a lower bound. Budget from the devnet figure.
- Scaling: the deposit is held per live receipt, so N receipts inside their windows hold
  N × 1,676,400 lamports (1,000 ≈ 1.676 SOL). Permanent receipts hold it forever.

---

## 13. Dependencies and provenance (disclosure)

The Official Rules (§9) require entrants to inform the administrator of the status and ownership
of open-source or third-party code. This is that inventory.

**CommitOnce's own code is entirely first-party and Apache-2.0.** No code was vendored, copied
or adapted from another Solana project. The durable-nonce *technique* is attributed to Squads'
`nonce-guard` in §9 and in `docs/PRIOR_ART.md`; the implementation is independent.

**Rust (program).**

| Dependency | Version | Role |
| --- | --- | --- |
| `anchor-lang` | 1.2.0 | program framework, IDL generation, account constraints |
| `solana-instructions-sysvar` | 3.0.0 | official Instructions-sysvar reader for nonce detection |

**Rust (tests only — not shipped in the program).** `litesvm` 0.10.0, `sha2` 0.10,
`solana-account` 3.0.0, `solana-clock` 3.0.1, `solana-hash` 3.0.0, `solana-instruction` 3.0.0,
`solana-keypair` 3.0.1, `solana-message` 3.0.1, `solana-pubkey` 3.0.0, `solana-rent` 3.0,
`solana-signer` 3.0.0, `solana-system-interface` 2.0.0, `solana-transaction` 3.0.2,
`solana-transaction-error` 3.0.0.

**TypeScript.** `@commitonce/solana` has **zero runtime dependencies**; `@solana/kit ^8.0.0`
(developed against 8.3.0) is a peer dependency, used by the caller's own transaction stack.
Dev-only: `@solana-program/system` 0.14.1, `@solana-program/token` 0.16.1, `typescript` 7.0.2,
`vitest` 5.0.1, `@types/node` 26.6.2. Root dev-only: `prettier` 3.9.8, `tsx` 4.23.13.

Exact resolved versions and integrity hashes are in `Cargo.lock` and `pnpm-lock.yaml`.

**Prior art by others, cited rather than obscured:** Light Protocol's `nullifier-program`,
`sol_idempotent`, `solana-asm/shield`, `p-never-nonce`, Squads' `nonce-guard`, Helium's
`lazy_transactions`, and Anchor's `init` idiom. What each does and what it does not is in
`docs/PRIOR_ART.md`, with primary-source quotations. **No pre-existing CommitOnce code exists to
disclose:** every file in this repository was written during the Contest Period, and
[`WORK_LOG.md`](WORK_LOG.md) records the dates.

---

## 14. Engineering decisions, and the prioritisation behind them

Judges ask why specific components were prioritised. These are the load-bearing decisions and
the reasoning.

| Decision | Choice | Why |
| --- | --- | --- |
| Framework | **Anchor 1.2.0** | Prebuilt CLI, IDL generation, ecosystem familiarity, and its official test path is LiteSVM. |
| Test harness | **LiteSVM 0.10.0** | Executes the real compiled SBF artifact, not a mock or a reimplementation. Tests assert on observable state, never on error strings. |
| SBPF target | **v2** (`--arch v2`) | `anchor build` defaults to v3, whose ELF (`e_flags = 0x3`) LiteSVM 0.10.0 rejects with `Instruction(InvalidAccountData)`. Shipping v3 would mean shipping a program this project's own suite cannot execute. v2 is accepted by LiteSVM, devnet and mainnet. Overridable with `SBPF_ARCH=v3`. |
| Receipt as a plain PDA, not compressed state | **plain 202-byte PDA** | Visible to any standard indexer, no prover dependency, no Light state tree, refundable, and the address is derivable offline. |
| Hashing | **WebCrypto `crypto.subtle`** | Zero runtime dependencies; available in Node 18+, browsers, Deno, Bun and workers. Async, which is not a real cost since PDA derivation and RPC are async anyway. |
| Authority scoping | **in the program's `seeds` constraint** | Makes the anti-griefing property structural instead of a convention integrators must remember. |
| Account count | **four, with the authority paying rent** | Minimises per-transaction byte overhead; removes a sponsor account from every guarded transaction while still allowing a relayer to pay the fee. |
| Program IDs | **identical on all clusters** | `declare_id!` is compiled in; a program deployed at a different address than its `declare_id!` refuses to run, so `scripts/build.sh` verifies the pairing after every build and **exits 1 on mismatch** rather than producing a silently broken artifact. |
| Priority of work | program and proof first, then product surface | The guarantee is the product. A guard that is not proven to block a rebuilt duplicate is a claim, so the test suite, the devnet deployment and the measured benchmarks came before any website or demo polish. |

**What was deliberately deprioritised**, so the choice is visible: no multisig or threshold
authority (a Squads vault can be the authority through a CPI that signs for its PDA — the CPI
path is tested in `tests/cpi.rs`, though the `invoke_signed` step a vault needs is not — but
per-member keys cannot share one receipt);
no hosted dashboard; no mainnet deployment before an audit; and no v1-message support until it
can be tested.

---

## 15. Reproducing every claim

```bash
# One command, as documented in EVIDENCE.md §8:
bash verify.sh

# Or the same steps individually:
bash scripts/build.sh                                     # builds both programs, verifies declare_id! against deploy-keys/
bash scripts/test.sh                                      # 50 tests, expect exit 0
bash scripts/test.sh --test benchmarks -- --nocapture      # the overhead table
pnpm --filter @commitonce/solana test                      # 71 tests
node packages/sdk/scripts/print-vectors.mjs                # vectors recomputed without importing the SDK

# Confirm the devnet deployment is live:
solana program show CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB --url devnet
solana program show EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5 --url devnet

# Live contention: one idempotency key in several transactions, fired at real validators.
# Costs about 0.003 SOL net (it sweeps the unspent balance back to the payer).
PAYER_KEYPAIR=~/.config/solana/id.json node apps/demo/concurrent-claim.ts --attempts 5
```

Build artifacts produced by `scripts/build.sh` (sizes and SHA-256 recorded in `EVIDENCE.md` §2,
and reproduced against `target/deploy/` when this document was written):

| Artifact | Size | SHA-256 |
| --- | --- | --- |
| `commit_once.so` | 160,008 bytes | `7e18f4d0c9cd17db6c03b3f2fe0bcb511d9264f9d0cf06ca5b8afc479035a0` |
| `demo_counter.so` | 158,160 bytes | `5947555c17fbfe32afc78e295d34935df8af94f0ac0ba7d23f2b4602f005727d` |

Both are built for SBPFv2 (`readelf -h` reports `Flags: 0x2`).

Test suite composition: `invariant.rs` 10 tests (the core guarantee, atomic rollback, scoping,
races, guard transparency), `retention.rs` 9 (expiry gates, rent refund, permissionless cleanup,
boundary values), `security.rs` 10 (griefing, receipt substitution, malformed state,
durable-nonce policy), `wire_format.rs` 10 (discriminator and layout pinning, golden hash
vectors, rent rate), `benchmarks.rs` 1 (the overhead table). Total 40.

---

## 16. Boundaries: what this does not do, and what is not verified

**Explicit non-goals** (`docs/SECURITY_MODEL.md` §7):

- It does **not make a transaction land.** It prevents a second execution, not a first failure.
  Retry-until-success is still the caller's job.
- It does **not protect unguarded code paths.** If your application can send the business
  instructions without `claim`, that path is unprotected. The guard is only as universal as its
  use.
- It does **not** guarantee anything across independent authorities: two keys are two intents,
  by design.
- It does **not resolve conflicts.** It detects and reports them; deciding what to do is the
  application's job.
- It does **not replace** signature-level deduplication, and does not interfere with it.
- It does **not** provide a global, network-wide key space. Receipts are per authority, per
  namespace, per key.
- It does **not** provide multisig or threshold authority today.
- The payload fingerprint is **only as good as what you put in it.**

**Not verified** (`EVIDENCE.md` §7, listed explicitly because a document that only lists
successes is not evidence):

| Claim | Status |
| --- | --- |
| Mainnet deployment | **Not done.** No mainnet keypair or funding exists. |
| Security audit | **Not done.** The program is unaudited. |
| npm publication | **Not done.** `@commitonce/solana` is not published. |
| Third-party integration | **None.** |
| Real users, traction, revenue | **None.** No such numbers exist and none are claimed. |
| Transaction v1 (`VersionedTransaction` v1) | **Not tested.** v1 is active on mainnet, devnet and testnet (<https://solana.com/docs/core/transactions/versioned-transactions>). It raises the size limit to 4,096 bytes, moves resource limits into a message config, and **removes address lookup tables**. The SDK and tests exercise legacy and v0 messages only. |
| Address lookup tables / v0 messages | **Tested end-to-end** in `tests/versioned.rs` — see §9. Previously "expected to work, but not verified". |
| Non-Anchor clients | **Verified.** Zero runtime dependencies, nothing imported from Anchor's JS library; every "Anchor" in `packages/sdk/src/` is a comment naming the discriminator it reproduces. Run against the deployed program on devnet. |
| CPI into `claim` from another program | **Tested** in `tests/cpi.rs` — see §9. |
| Genuine durable-nonce transactions | **Tested against devnet** in `apps/demo/nonce-policy.ts`. The harness cannot express one — see §9 — so the Rust test injects the marker, and the live script closes that gap. |
| SBPFv3 build | **Not verified**, and deliberately not shipped, because LiteSVM cannot verify it. |
| Compute units on mainnet | **Not measured.** |

**Known limitations** (`docs/ARCHITECTURE.md` §11): the window is finite unless `permanent` is
chosen; the authority is a single key with no multisig today; durable-nonce transactions require
`retention: 'permanent'`; a conflicting payload is detected rather than resolved; retention is
per-claim, not per-namespace, so a caller can choose a short retention for one intent and a long
one for the next; and the program is unaudited.
