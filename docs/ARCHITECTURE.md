# CommitOnce — architecture

**Onchain idempotency keys for Solana actions.** Retry without executing twice.

This document explains how the guarantee is constructed, why each design decision was
made, and where the boundaries of the guarantee are.

---

## 1. The problem, precisely

Solana's runtime deduplicates transactions by **message hash**. Two transactions with
identical message bytes have the same hash, and the status cache refuses the second one —
surfacing as `AlreadyProcessed`. Agave's own source comments this explicitly:

> *"add the message hash to the status cache to ensure that this message won't be
> processed again with a different signature."*

That protection is **content-addressed**: it protects *signed bytes*.

It does not protect a **logical intent**. Consider a payment. The client submits, the
response times out, and the client cannot tell whether the transaction landed. It
rebuilds: fresh blockhash, a higher priority fee because the first attempt was slow, a
different route, a re-signed transaction. The message hash is different, so the runtime
sees a brand new transaction. **Both can land.**

Solana's official production-readiness guidance says this outright and then hands the
problem back to the application:

> *"A rebuilt transaction has a new signature, so preserve application-level idempotency
> before sending it."*

Every transaction-delivery vendor repeats the same handoff. Helius documents that
`sendTransaction` *"does not alter the transaction in any way; it relays the transaction
created by clients to the node as-is"*, and warns that re-signing *"can lead to duplicate
transactions being confirmed."* Triton tells clients to *"handle retries in your own
code… set `maxRetries: 0`."* The layer that would make "did my intent already happen?" a
question the chain can answer does not exist as a product.

**CommitOnce is that layer.**

---

## 2. The mechanism

A single instruction, prepended to the transaction the caller already builds:

```text
┌──────────────────────────────────────────────────────────────┐
│ one atomic Solana transaction                                │
├──────────────────────────────────────────────────────────────┤
│ 1. commit_once::claim(namespace, key, payload, retention)    │
│      ├─ receipt PDA absent  → create it, continue            │
│      └─ receipt PDA present → ERROR → whole tx rolled back   │
│ 2. …your business instructions…                              │
│      jupiter swap / SPL transfer / mint / game action / …    │
└──────────────────────────────────────────────────────────────┘
```

The receipt is a plain program-owned PDA. Its address is derived from the intent's
identity, so "has this intent already committed?" is answered by *whether an account
exists* — a check that is atomic with the action it guards, and that no amount of
transaction rebuilding can bypass, because it lives in chain state rather than in signed
bytes.

### The invariant

> For one `(authority, namespace_hash, idempotency_key_hash)` tuple, no more than one
> guarded transaction may successfully commit during the receipt retention period.

This is **at-most-once successful execution within a retention window.** Combined with
ordinary retry-until-success it produces exactly-once-style application semantics. It is
not a claim of mathematically universal exactly-once execution, and the documentation says
so everywhere.

### Two consequences that follow from atomicity

Solana transactions are all-or-nothing, which gives the design two properties that would
otherwise need explicit handling:

1. **A receipt cannot exist without its action having committed.** If any later
   instruction fails, the whole transaction — receipt included — is rolled back. There is
   no window in which a receipt exists but the business action did not happen, so a failed
   attempt stays retryable. This is tested by
   `downstream_failure_rolls_back_the_receipt`.
2. **A blocked duplicate cannot partially execute.** When `claim` errors, the error fails
   the transaction, so the business instructions after it never run. This is tested by
   `with_guard_rebuilt_retry_is_blocked_and_business_action_runs_once`.

---

## 3. Receipt identity

```text
receipt PDA = find_program_address(
    seeds = [
        b"commit-once",        // 11 bytes — domain prefix
        authority,             // 32 bytes — the signer
        namespace_hash,        // 32 bytes — sha256("commitonce/namespace/v1" || namespace)
        idempotency_key_hash,  // 32 bytes — sha256("commitonce/key/v1" || key)
    ],
    program_id = CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB,
)
```

Every seed is a fixed size. Arbitrary-length namespace and key strings never enter the
seeds directly, which avoids the 32-byte-per-seed limit and makes the derivation a single,
testable, cross-language definition.

### Why the authority is in the seeds

This is the decision that matters most for security. Because the authority is part of the
derivation, **a third party who learns your namespace and key derives a different address.**
They cannot consume your key, and they cannot block your intent. The property is enforced
by the program's `seeds` constraint rather than left to callers to remember.

Without it, an onchain "have I done this already?" guard becomes a griefing vector: anyone
who can guess an id can claim it first and permanently block the legitimate intent. This
is tested by `third_party_cannot_consume_another_authoritys_key`.

### Why hashes are derived client-side

Hashing off-chain keeps the program's instruction data fixed-size, keeps unbounded strings
out of PDA seeds, and lets the derivation be pinned by tests in **two** languages. The
domain separators mean a namespace hash can never equal a key hash, so an application
cannot shadow another's key space by choosing a colliding string.

The exact derivation is asserted to fixed hex values in both
`programs/commit-once/tests/wire_format.rs` and
`packages/sdk/test/vectors.test.ts`. `packages/sdk/scripts/print-vectors.mjs` recomputes
the same values from `@solana/kit` primitives *without importing the SDK*, so the two
suites cannot agree by construction.

---

## 4. Payload fingerprint: what "the same intent" means

The receipt stores a 32-byte `payload_hash`. Reusing a key with a **different**
fingerprint is reported as `IdempotencyConflict` rather than silently treated as a
duplicate — so `order_928` for 10 USDC and `order_928` for 100 USDC are distinguishable,
and the second one fails loudly instead of silently returning the first one's result.

The fingerprint covers the **semantic** content of the action and nothing else. It must
never include transport details:

| Included (semantic) | Excluded (transport) |
| --- | --- |
| recipient, amount, mint | blockhash |
| memo, order id, chain id | signature |
| program ids being invoked | priority fee, compute budget |
| | retry count, submission route |

Including any transport detail would make a retry look like a different intent, defeating
the entire purpose. `encodeIntent` produces a deterministic, injective, length-prefixed
encoding (`<tag><length>:<payload>`), with object keys sorted so insertion order cannot
change the result. It throws on `undefined` rather than dropping it the way
`JSON.stringify` does, because silently dropping a property could make two genuinely
different intents encode identically and hide a conflict.

---

## 5. Retention, expiry and cleanup

`claim` takes `retention_seconds: u64`:

| Value | Meaning |
| --- | --- |
| `0` | **permanent** — never expires, can never be closed |
| `3600 … 31_536_000` | 1 hour … 365 days |
| anything else | rejected with `InvalidRetention` |

The receipt records **two** deadlines:

* `expires_at_slot` — monotonic, derived as `created_slot + retention * SLOTS_PER_SECOND`.
  Manipulation-proof, but depends on an assumed slot rate.
* `expires_at_unix_ts` — wall clock. Keeps the advertised retention honest if slots run
  faster than assumed.

`close_receipt` requires **both** gates to have passed. This asymmetry is deliberate: a
change in slot timing can therefore only ever *delay* cleanup (safe — the receipt lives
longer than advertised) and never *accelerate* it into a window where a still-valid signed
duplicate could execute.

`SLOTS_PER_SECOND` is `4`, reflecting mainnet's 250 ms slots since epoch 1036, not the
historical 400 ms target. Underestimating it would silently shorten the advertised window.

### Cleanup is permissionless and cannot steal

`close_receipt` refunds the deposit to the `refund_destination` recorded at claim time,
and the program refuses any other destination (`address = receipt.refund_destination`).
So anyone may submit the cleanup transaction and pay its fee, while the deposit always
returns to the configured account. Cleanup therefore does not require the authority to be
online, and cannot be used to redirect funds.

### Closing reopens the key — deliberately

Once closed, the same `(authority, namespace, key)` can be claimed again. **This is the
documented cost of a bounded window, not an oversight.** It is why the guarantee is stated
as "within the retention period", and it is tested by
`closing_frees_the_key_for_a_new_claim`.

---

## 6. Durable-nonce policy

A durable-nonce transaction never expires. An old signed duplicate stays executable
forever. If its receipt could be cleaned up, cleanup would reopen the duplicate window —
silently breaking the guarantee.

So `claim` inspects the Instructions sysvar for a System Program `AdvanceNonceAccount`
instruction (discriminator `u32` LE `4`) and **rejects the transaction with
`DurableNonceUnsupported` unless `retention_seconds == 0`.**

Permanent receipts have no cleanup path, so they are safe to combine with nonces and are
explicitly supported.

The conceptual approach — rejecting nonce transactions via instructions-sysvar inspection
— is borrowed from Squads' `nonce-guard`. That program does the *opposite* of its name (it
deduplicates nothing; its PDA is per-owner, not per-intent) but it is a good demonstration
that the introspection technique works. The implementation here is written independently.

---

## 7. Account set and instruction layout

`claim` takes exactly four accounts, in this order:

| # | Account | Role | Why |
| --- | --- | --- | --- |
| 0 | `authority` | writable + signer | Pays the rent deposit. Must precede `receipt` because the seeds reference it. |
| 1 | `receipt` | writable | The PDA, constrained by `seeds`/`bump`. |
| 2 | `instructions_sysvar` | read-only | Address-constrained; used for nonce detection. |
| 3 | `system_program` | read-only | Needed only when creating the receipt. |

Keeping the account set to four minimises transaction byte overhead. The authority is the
rent payer rather than a separate sponsor account, which removes one account from every
guarded transaction; relayers can still pay the *fee*.

The authority being writable is what allows it to pay rent directly, so a guard costs one
extra account (`receipt`) plus two read-only system accounts that are already present in
most transactions.

### Why manual account handling instead of `init_if_needed`

`init_if_needed` cannot distinguish "I just created this" from "this already existed" —
and that distinction *is* the entire semantic of `claim`. A guard built on
`init_if_needed` would silently become an upsert and deduplicate nothing.

So `claim` declares the receipt as an `UncheckedAccount` with a `seeds`/`bump` constraint
and then verifies ownership and contents manually before trusting a pre-existing account:

* absent (`data_is_empty()`) → create via `invoke_signed` and write the receipt
* present → check owner is this program, check the discriminator deserializes, check
  `version`, check `authority` and both hashes match, then fail with
  `AlreadyCommitted` (matching payload) or `IdempotencyConflict` (different payload)

---

## 8. Data layout

`IntentReceipt` — 202 bytes including the 8-byte Anchor discriminator:

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 8 | discriminator `sha256("account:IntentReceipt")[0..8]` |
| 8 | 1 | `version` |
| 9 | 1 | `bump` |
| 10 | 32 | `authority` |
| 42 | 32 | `namespace_hash` |
| 74 | 32 | `idempotency_key_hash` |
| 106 | 32 | `payload_hash` |
| 138 | 32 | `refund_destination` |
| 170 | 8 | `created_slot` |
| 178 | 8 | `expires_at_slot` (0 = permanent) |
| 186 | 8 | `created_unix_ts` |
| 194 | 8 | `expires_at_unix_ts` (0 = permanent) |

The layout is fixed-size and versioned so indexers and the SDK can decode it without an
IDL round trip. `packages/sdk/src/accounts.ts` decodes it with a documented offset table,
and both test suites pin the size and the offsets.

`claim` instruction data — 144 bytes:

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 8 | discriminator `sha256("global:claim")[0..8]` |
| 8 | 32 | `namespace_hash` |
| 40 | 32 | `idempotency_key_hash` |
| 72 | 32 | `payload_hash` |
| 104 | 8 | `retention_seconds` (u64 LE) |
| 112 | 32 | `refund_destination` |

---

## 9. Component map

```text
commitonce/
├── programs/
│   ├── commit-once/          the guard program
│   │   ├── src/lib.rs              entrypoint, declare_id!
│   │   ├── src/constants.rs        seeds, retention bounds, slot rate, nonce discriminator
│   │   ├── src/state.rs            IntentReceipt layout
│   │   ├── src/error.rs            11 custom errors, codes 6000–6010
│   │   ├── src/events.rs           IntentCommitted, IntentReceiptClosed
│   │   └── src/instructions/
│   │       ├── claim.rs            create-or-abort + nonce policy
│   │       └── close_receipt.rs    dual-gate expiry + rent refund
│   └── demo-counter/         a business program that knows nothing about CommitOnce
├── packages/sdk/             @commitonce/solana — dual ESM/CJS, zero runtime deps
├── apps/demo/                the A/B failure reproduction
├── examples/                 SOL transfer, SPL transfer, generic program, Jupiter-style swap
├── docs/                     architecture, security model, prior art, integration playbook
└── submission/               Colosseum submission package
```

The SDK's `prepare()` is **pure**: it derives everything locally with WebCrypto and needs
no RPC, prover or indexer. That is what makes the guard usable inside a wallet, a relayer,
or an offline signer — and it is the property that most clearly separates this from guard
primitives whose instruction cannot be built without a proof fetch.

---

## 10. Framework and build decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Framework | **Anchor 1.2.0** | Prebuilt CLI, IDL generation, ecosystem familiarity, and its official test path is LiteSVM. |
| Test harness | **LiteSVM 0.10.0** | Executes the real compiled SBF artifact, not a mock. Tests assert on observable state, never on error strings. |
| SBPF target | **v2** (`--arch v2`) | `anchor build` defaults to v3, whose ELF (`e_flags = 0x3`) LiteSVM 0.10.0 rejects with `InvalidAccountData`. Building v3 would mean shipping a program the project's own test suite cannot run. v2 is accepted by LiteSVM, devnet and mainnet. Override with `SBPF_ARCH=v3`. |
| Build cache | `CARGO_TARGET_DIR` on ext4 | The repo lives on a Windows drive; only small artifacts land in the workspace. |
| Program IDs | identical on all clusters | `declare_id!` is compiled in; a program deployed at a different address than its `declare_id!` refuses to run. `scripts/build.sh` verifies the pairing after every build. |
| Hashing | WebCrypto `crypto.subtle` | Zero runtime dependencies, available in Node 18+, browsers, Deno, Bun and workers. Async, which is not a real cost since PDA derivation and RPC are async anyway. |

---

## 11. Known limitations

Stated plainly, because a security model that only lists strengths is not a security model.
See `docs/SECURITY_MODEL.md` for the full threat analysis.

1. **The window is finite unless you choose `permanent`.** After cleanup the key is free
   again. `permanent` costs the rent deposit forever (1,676,400 lamports at mainnet rates).
2. **The authority is a single key.** There is no multisig or threshold authority today; a
   Squads vault can be the authority through a CPI that signs for its PDA — the CPI path is
   tested in `tests/cpi.rs`, though the `invoke_signed` step a vault needs specifically is not —
   but per-member keys cannot share one receipt.
3. **Durable-nonce transactions need `retention: 'permanent'`.**
4. **A conflicting payload is detected, not resolved.** The program tells you the key was
   used for something else; deciding what to do is the application's job.
5. **The payload fingerprint is only as good as what you put in it.** If two different
   actions hash to the same intent, the conflict is not detected. Pass semantic fields,
   never transport details.
6. **Not audited.** See `SECURITY.md`.
7. **Retention is per-claim, not per-namespace.** A caller can pick a short retention for
   one intent and a long one for the next.
