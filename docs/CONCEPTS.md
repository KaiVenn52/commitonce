# CommitOnce — concepts and mental model

CommitOnce is **idempotency keys for Solana**. It makes one guarantee, and the whole
document is an explanation of what that guarantee does and does not cover:

> For one `(authority, namespace, idempotency key)` tuple, **no more than one guarded
> transaction may successfully commit during the receipt retention period.**

That is **at-most-once successful execution of a logical intent within a retention
window.** It is not "exactly once", and nothing in this repository should ever be described
that way. The three load-bearing parts of the sentence — *at most once*, *guarded*, *within
the retention period* — are unpacked below.

This document is the mental model. [`ARCHITECTURE.md`](./ARCHITECTURE.md) covers the
implementation, and [`SECURITY_MODEL.md`](./SECURITY_MODEL.md) covers the threat analysis.
The program is **unaudited**.

---

## 1. Intent vs transaction

A **transaction** is a signed message: a fee payer, a blockhash, a list of instructions, a
signature. It is a transport artifact.

An **intent** is what the user asked for: "pay order 928 — 10 USDC to Alice, once."

Those are not the same object, and the difference is where duplicate execution comes from.
The canonical failure:

1. A client builds a transaction for the intent and submits it.
2. The RPC call times out. The client does not know whether the transaction landed.
3. The client rebuilds: fresh blockhash, a higher priority fee because the first attempt
   was slow, a different route, a re-signed transaction.
4. Both transactions are valid, both can land, and the payment happens twice.

Step 3 is not a bug in the client. It is what every retry implementation does, because the
client has no way to ask the chain "did this *intent* already happen?" — that question is
not expressible in terms of signed bytes.

CommitOnce makes that question expressible. It writes the intent's identity into chain
state, atomically with the action it guards, so the answer survives any amount of
rebuilding.

---

### Numbers: use `bigint` past 2^53

The payload fingerprint hashes what you pass, so it is only as faithful as the value that
reaches it. JavaScript cannot represent every integer exactly:

```js
Number("9007199254740993") === 9007199254740992   // true
String(Number("9007199254740993"))                // "9007199254740992"
```

A caller who parses a large amount out of a string — a lamport total, a token amount in
base units, an id — gets **a different number than they wrote**, and the fingerprint would
describe an intent nobody wrote. That is the one thing the payload hash exists to prevent.

The SDK refuses an integer outside the safe range (±2^53 − 1) rather than encoding it:

```text
TypeError: CommitOnce: intent contains the integer 9007199254740992, which is outside the
safe range (±2^53 − 1) and may not be the number you wrote. `Number("9007199254740993")`
is `9007199254740992`, so a parsed large amount silently changes and the fingerprint would
describe an intent nobody wrote. Pass it as a `bigint` — `9007199254740993n` — which is
exact and encodes differently from its neighbours.
```

`bigint` is exact and already supported, so the fix is a one-character change:

```js
await prepareIntent({ intent: { amount: 9007199254740993n }, ... })   // fine
await prepareIntent({ intent: { amount: 1.5 } })                      // fine, exact
await prepareIntent({ intent: { amount: Number.MAX_SAFE_INTEGER } })  // fine, the boundary
```

Non-integers are unaffected — `1.5` is exactly representable. And the check cannot
distinguish a deliberate `1e21` from a lost-precision parse, so it refuses both. That is
the right trade for a fingerprint: an integer beyond 2^53 is far more likely to be a parse
artifact than a value someone meant exactly.

See `packages/sdk/test/vectors.test.ts` — eight tests, including one that pins the
boundary case where a written fraction is absorbed by the magnitude.

## 2. Why message-hash deduplication is not intent deduplication

Solana's runtime deduplicates transactions by **message hash**. Two transactions with
identical message bytes have the same hash, and the status cache refuses the second one,
surfacing as `AlreadyProcessed`. Agave's own runtime source states the purpose explicitly:

> *"add the message hash to the status cache to ensure that this message won't be processed
> again with a different signature."*

Read that carefully, because it is precise about what it protects: it stops the *same
message* from being re-processed under a *different signature*. The protection is
**content-addressed**. It protects *signed bytes*.

Solana's official production-readiness guidance states the gap and hands the problem back
to the application:

> *"A rebuilt transaction has a new signature, so preserve application-level idempotency
> before sending it."*

So the layers look like this:

| Layer | Keys on | Protects against | Does not protect against |
| --- | --- | --- | --- |
| Runtime status cache | message hash (bytes) | the identical transaction re-submitted | any rebuild: new blockhash, new fee, new route, re-sign |
| CommitOnce receipt | `(authority, namespace, key)` in chain state | a rebuilt transaction for the same intent | a *different* intent, or an unguarded code path |

The two layers are complementary, not alternatives. CommitOnce does not replace or
interfere with the runtime's deduplication: a byte-identical rebroadcast is still rejected
by the status cache, which the test `identical_rebroadcast_still_rejected_by_the_runtime`
asserts.

The handoff is not controversial — every transaction-delivery vendor repeats it. As
recorded in [`ARCHITECTURE.md`](./ARCHITECTURE.md) §1, Helius documents that
`sendTransaction` *"does not alter the transaction in any way; it relays the transaction
created by clients to the node as-is"* and warns that re-signing *"can lead to duplicate
transactions being confirmed"*; Triton tells clients to *"handle retries in your own
code… set `maxRetries: 0`."* The layer that would make "did my intent already happen?" a
question the chain can answer did not exist as a product. CommitOnce is that layer.

---

## 3. The mechanism, in one picture

One instruction, prepended to the transaction you already build:

```text
┌──────────────────────────────────────────────────────────────┐
│ one atomic Solana transaction                                │
├──────────────────────────────────────────────────────────────┤
│ 1. commit_once::claim(namespace, key, payload, retention)    │
│      ├─ receipt PDA absent  → create it, continue            │
│      └─ receipt PDA present → ERROR → whole tx rolled back   │
│ 2. …your business instructions…                              │
│      SPL transfer / swap / mint / game action / …            │
└──────────────────────────────────────────────────────────────┘
```

The receipt is an ordinary program-owned PDA whose address is derived from the intent's
identity. "Has this intent already committed?" is therefore answered by *whether an account
exists* — a check that lives in chain state, not in signed bytes, and that no amount of
transaction rebuilding can bypass.

### What atomicity buys

Solana transactions are all-or-nothing. Two properties follow for free:

1. **A receipt cannot exist without its action having committed.** If a later instruction
   fails, the whole transaction — receipt creation included — is rolled back. A failed
   attempt stays retryable; the key is not poisoned by a failure. (Test:
   `downstream_failure_rolls_back_the_receipt`, which also asserts that only the
   transaction fee is spent and the rent deposit comes back.)
2. **A blocked duplicate cannot partially execute.** When `claim` errors, the error fails
   the transaction, so every instruction after it is discarded. (Test:
   `with_guard_rebuilt_retry_is_blocked_and_business_action_runs_once`.)

Note the direction of the asymmetry: the receipt is *created* first and *committed* only
with everything else. There is no window in which the receipt says "done" while the action
did not happen, and no window in which the action happened while the receipt is missing.

---

## 4. At-most-once, not exactly-once

These are different promises, and conflating them is the most common way to misdescribe
this tool.

| | Exactly once | CommitOnce: at most once |
| --- | --- | --- |
| A second execution | impossible | impossible within the retention window |
| A first execution | guaranteed | **not** guaranteed — a transaction can still fail to land |
| Whose job is delivery | the system | yours: keep retrying until it lands |

CommitOnce prevents a duplicate. It does not make anything land. Combined with ordinary
retry-until-success, the pair produces exactly-once-style *application* semantics: the
client retries freely, and at most one of its attempts commits. That composition is the
product; the primitive alone is not.

Practically: your retry loop stays exactly as it is, with one change — an
`AlreadyCommitted` error means "the intent committed", which is success, not failure. See
[`INTEGRATION_PLAYBOOK.md`](./INTEGRATION_PLAYBOOK.md) §8.

---

## 5. What identifies an intent

Four values, and it matters which three are in the address and which one is only stored.

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

* **The address** is a function of `(authority, namespace, key)` and nothing else.
* **The payload fingerprint** (`payload_hash`) is stored *in* the receipt, and is compared
  when a receipt already exists.

That split is deliberate, and it produces two distinct outcomes:

| Situation | Result | Meaning |
| --- | --- | --- |
| Receipt absent | created, transaction continues | first commit of this intent |
| Receipt present, same `payload_hash` | `AlreadyCommitted` (6000) | a duplicate — the expected outcome of a retry |
| Receipt present, different `payload_hash` | `IdempotencyConflict` (6001) | the key was reused for a *different* action |

Without the stored fingerprint, reusing `order_928` for 10 USDC and then for 100 USDC would
look like a harmless duplicate and the second payment would be silently dropped. With it,
the second one fails loudly. A conflict never overwrites the stored fingerprint, so the
first accepted intent stays authoritative.

The fingerprint must cover the **semantic** content of the action and nothing else — see
[`INTEGRATION_PLAYBOOK.md`](./INTEGRATION_PLAYBOOK.md) §5 for the include/exclude rules.
Including a blockhash, signature, priority fee, compute budget or retry counter would make
every retry look like a new intent and defeat the guard entirely.

---

## 6. Namespaces

A namespace is a caller-chosen string that scopes a key space: `payments:transfer`,
`jobs:settle`, `app_a:swap`. It exists so that two features — or two applications sharing an
authority — can both use the key `order_928` without colliding.

Three properties matter:

* **It is hashed, not stored raw.** `namespace_hash = sha256("commitonce/namespace/v1" ||
  namespace_utf8)`, and the receipt PDA takes the 32-byte hash. Arbitrary-length strings
  therefore never enter PDA seeds, and the program never has to reason about string
  encoding.
* **The two domains are separated.** Namespaces hash under `commitonce/namespace/v1` and
  keys under `commitonce/key/v1`, so a namespace hash can never equal a key hash. An
  application cannot shadow another's key space by choosing a colliding string. (Tests:
  `namespace_and_key_domains_are_separated` in Rust, and the same assertion in the SDK's
  `vectors.test.ts`.)
* **There is no registry.** A namespace is a convention, not a claimed name. Two systems
  under the *same authority* that pick the *same namespace* and the *same key* will collide
  by design — that is the intended semantics of "same key", not a bug. Choose a namespace
  you control and keep it stable: changing it changes the receipt address, so receipts
  created under the old namespace no longer protect the new claims.

---

## 7. Authority scoping, and why it prevents griefing

The authority is part of the receipt derivation. This is the single most important
difference from guard designs whose keys are not authority-scoped.

Consider the alternative. If a receipt were keyed only by `(namespace, key)`, then anyone
who learned your order id could claim `payments:transfer / order_928` first — with any
payload they liked — and your legitimate claim would then hit a receipt that already
exists. For a payment or a mint, that is a denial of service that costs the attacker a
transaction fee. An onchain "have I done this already?" guard without authority scoping is
a griefing primitive.

With the authority in the seeds, the attacker's claim lands on a *different address* and
leaves your key untouched. The property is enforced by the program's `seeds`/`bump`
constraint, so it holds by construction rather than depending on a developer remembering to
hash their own pubkey into the key. Test:
`third_party_cannot_consume_another_authoritys_key` — the attacker front-runs with the
victim's exact namespace and key, and the victim's subsequent claim still succeeds.

Two consequences worth stating plainly:

* **Whoever controls the authority can block the intent.** That is unavoidable: the
  authority is the identity. If you share one authority across tenants (a single relayer
  key, a shared ops wallet), you have also shared a key space.
* **Cleanup is permissionless.** Anyone may close an *expired* receipt — see §8. They
  cannot redirect the deposit, but they can end your protection window early *relative to
  the retention you chose*. Choose retention accordingly.

---

## 8. Receipt lifecycle

```text
                     claim (receipt PDA absent)
        unclaimed ──────────────────────────────▶ committed
            ▲                                       │
            │                                       │ both deadlines pass
            │  close_receipt                        ▼
            │  (anyone may submit;                  expired
            │   deposit → recorded destination)      │
            └────────────────────────────────────────┘
                             (key free again)

        committed / expired ──claim again──▶ AlreadyCommitted (6000)
                                            [different payload → 6001]
```

**Unclaimed.** No account exists. The key is free; a `claim` creates the receipt.

**Committed.** The receipt exists and its deadlines have not passed. Every subsequent
`claim` for the same `(authority, namespace, key)` fails the transaction — with
`AlreadyCommitted` if the payload matches, `IdempotencyConflict` if it does not.

**Expired.** Both deadlines have passed, so the receipt *may* be closed. This is the part
that surprises people: **expiry by itself does not stop the guard.** An expired receipt is
still an account, so `claim` still finds it and still aborts. Expiry only makes cleanup
*permitted*; the protection ends when someone actually closes it. In practice you should
close expired receipts yourself, both to reclaim the rent and to keep the semantics of
"protected" equal to "the receipt exists".

**Closed.** The account is gone, the rent deposit is returned to the destination recorded
at claim time, and the key is free. A later claim for the same tuple creates a fresh
receipt and succeeds. **Closing deliberately reopens the key** — that is the documented
cost of a bounded window, not an oversight. Test: `closing_frees_the_key_for_a_new_claim`.

Who can close: **anyone**. The `refund_destination` account is constrained to the value
recorded on the receipt, so the deposit cannot be redirected, which is what makes
permissionless cleanup safe. Test: `close_requires_the_configured_refund_destination`.
Cleanup therefore does not require the authority to be online — a keeper, a cron job, or a
third party can do it, and the money still goes where it belongs.

---

## 9. The retention window is a deliberate trade-off

The guarantee is **bounded**. That is stated up front because an unbounded claim would be
false.

| Retention | Deposit held per receipt | Reopen risk after cleanup |
| --- | --- | --- |
| `3600` – `31536000` seconds (1 hour – 365 days) | 1,676,400 lamports (0.00168 SOL) | yes, after expiry and close |
| `0` (**permanent**) | 1,676,400 lamports, never returned | none — there is no cleanup path |

Three design points explain the shape of that table.

**Why a one-hour floor.** A transaction built on a recent blockhash is valid only for
roughly `MAX_PROCESSING_AGE` slots — about **40 seconds** at mainnet's measured 265 ms. If a
receipt could be cleaned up inside that window, a still-valid signed duplicate could execute
*after* cleanup, silently reopening the duplicate window. One hour is nearly two orders of
magnitude longer than the blockhash window, so no accepted configuration allows cleanup to
outrun a live duplicate. (Test: `retention_below_minimum_is_rejected`.)

**Why a 365-day ceiling.** Past a year, a finite window stops being a meaningful
protection and starts being a way to hold rent that nobody can reclaim. `0` (permanent) is
the explicit choice for "never expires", and it is honest about its cost: the deposit is
never refunded, because there is no close path at all.

**Why cleanup exists.** Without it, every receipt would be permanent, and a payment
processor issuing a million intents would lock roughly 1,676 SOL in rent forever. Cleanup
makes the primitive economically usable at volume: you pay the deposit while an intent is
within its window, and get it back afterwards.

The honest framing is one sentence: **choose a retention that exceeds your maximum retry
horizon.** If a client, an operator, or a webhook redelivery might retry an intent after a
week, a one-hour retention is the wrong choice. Retention is set per claim, so you can use
different values for different intents — and the program will not stop you from choosing a
short one for a later intent.

The rent figure is the mainnet rate since SIMD-0437 step 2: `(202 data bytes + 128 account
overhead) × 5080 lamports/byte = 1,676,400 lamports`. The `solana-rent` Rust crate still
ships an effective 6960 lamports/byte (`DEFAULT_LAMPORTS_PER_BYTE_YEAR = 3480` with an
exemption threshold of `2.0`), so any figure derived from that crate is **37% too high**.
The deposit is not hardcoded in the program: `claim` calls
`Rent::get()?.minimum_balance(space)`, so it follows whatever the cluster's rent sysvar
says.

---

## 10. Why the guard must be in the *same* transaction

The guard is not a lock you take, then act on, then release. It is a check that is atomic
with the action. Both alternatives are broken, and it is worth seeing why.

**Claim first, act second (two transactions).** There is now a window in which the receipt
exists but the business action has not happened. If the client crashes, is killed, or the
second transaction simply fails, the key is poisoned: the receipt exists, the action never
happened, and every retry is refused as a duplicate. You would need a compensating action
to unlock it — and that compensating action is itself a distributed-systems problem. You
would also pay two transaction fees and two round trips for every guarded action.

**Act first, claim second.** The duplicate has already executed by the time the guard
notices. Nothing is prevented.

**Same transaction.** Solana's runtime gives all-or-nothing execution for free, so:

* the receipt and the action commit together or not at all;
* a blocked duplicate cannot partially execute — the error discards the whole transaction;
* a failed attempt leaves no state behind, so retrying is always safe.

This is also why CommitOnce is a *separate instruction* rather than a modification of your
program. The downstream program does not integrate, import, or even know that CommitOnce
exists — the `demo-counter` program in this repository is the proof, and the test
`guard_is_transparent_to_the_business_instructions` asserts that the business action
produces its normal effect once the guard has passed.

The one hard requirement that follows: the guard and the business instructions must be in
the same transaction, which means the authority must be a signer of that transaction (it
pays the rent deposit and its signature is what the `seeds` constraint binds to). If a
relayer pays the fee, that is fine — the fee payer and the authority are different roles.

---

## 11. Two deadlines, and why both

A receipt records **two** expiry values:

| Deadline | Derived from | Property |
| --- | --- | --- |
| `expires_at_slot` | `created_slot + retention × 4` | monotonic; not validator-manipulable |
| `expires_at_unix_ts` | `created_unix_ts + retention` | keeps the *advertised* retention honest if slots run fast |

`close_receipt` requires **both** gates to have passed. The asymmetry is the point:

* The slot counter cannot be manipulated by a validator, but it assumes a slot rate.
  `SLOTS_PER_SECOND = 4` (measured at **3.77 slots/second on mainnet**, 265 ms, and **6.09 on
  devnet**, 164 ms), and because cleanup requires *both* gates the effective deadline is the
  **later** of the two — so a wrong constant delays cleanup rather than shortening the window.
* The wall clock is what the user actually cares about, but a program cannot independently
  verify `Clock::unix_timestamp`.

Because the gates are ANDed, a change in slot timing can only ever **delay** cleanup (the
receipt lives longer than advertised — safe) and never **accelerate** it into a window
where a still-valid signed duplicate could execute. (Tests:
`slot_deadline_uses_current_mainnet_slot_rate`, `receipt_cannot_be_closed_before_expiry`,
which checks each gate in isolation.)

---

## 12. Durable-nonce transactions

A durable-nonce transaction never expires: an old signed duplicate stays executable
indefinitely. If its receipt could be cleaned up, cleanup would reopen the duplicate window
— permanently, and silently.

So `claim` inspects the Instructions sysvar for a System Program `AdvanceNonceAccount`
instruction (discriminator `u32` LE `4`) and **rejects the transaction with
`DurableNonceUnsupported` (6002) unless `retention_seconds == 0`.** Permanent receipts have
no cleanup path, so they are safe to combine with nonces and are explicitly supported.

Two details worth knowing:

* The scan covers every instruction in the transaction, not just the first, which is
  deliberately stricter than necessary. An already-signed durable-nonce transaction cannot
  have its advance instruction stripped, because the signature covers the whole message.
* The check is about the *presence* of the marker, not about how the runtime classifies the
  transaction. A test harness that cannot construct a genuine nonce transaction still
  exercises the policy — see the long comment in `tests/security.rs` for exactly what
  LiteSVM can and cannot express here.

---

## 13. Where the guarantee ends

Stated plainly, because a model that only lists strengths is not a model. The full list is
in [`SECURITY_MODEL.md`](./SECURITY_MODEL.md) §7.

* **Unguarded code paths are unprotected.** Only transactions that actually include `claim`
  are covered. If any path in your application can send the business instructions without
  the guard, that path has no protection at all. The guard is only as universal as its use
  — see the checklist in [`INTEGRATION_PLAYBOOK.md`](./INTEGRATION_PLAYBOOK.md) §7.
* **The window is finite unless you choose `permanent`.** After cleanup the key is free.
* **Two authorities are two identities.** Independent keys cannot share one receipt, so
  authority scoping gives no protection against a second authority doing the same thing.
* **Conflicts are detected, not resolved.** The program tells you the key was used for
  something else; deciding what to do is your application's job.
* **The fingerprint is only as good as its inputs.** If two different actions hash to the
  same payload, the conflict is invisible.
* **Not audited.** The program has no independent review. Treat the security model as a
  specification to be checked, not as evidence.

---

## 14. Reading order

| If you want to… | Read |
| --- | --- |
| get something running now | [`QUICKSTART.md`](./QUICKSTART.md) |
| add the guard to a live application | [`INTEGRATION_PLAYBOOK.md`](./INTEGRATION_PLAYBOOK.md) |
| look up an exact signature, offset or error code | [`API_REFERENCE.md`](./API_REFERENCE.md) |
| get a straight answer to a hard question | [`FAQ.md`](./FAQ.md) |
| understand the implementation | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| understand the threat model | [`SECURITY_MODEL.md`](./SECURITY_MODEL.md) |
