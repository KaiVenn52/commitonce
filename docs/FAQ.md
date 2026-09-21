# CommitOnce FAQ

Direct answers to hard questions. Everything here is grounded in the source
(`programs/commit-once/src/**`, `packages/sdk/src/**`), in
[`ARCHITECTURE.md`](./ARCHITECTURE.md) and [`SECURITY_MODEL.md`](./SECURITY_MODEL.md), or in
the test suite in `programs/commit-once/tests/`. Where a capability is not tested, it says
so.

**The program is unaudited. Nothing here claims it is deployed anywhere or used by anyone.**

The guarantee, stated exactly once so the rest of the document can refer to it:

> For one `(authority, namespace, idempotency key)` tuple, no more than one guarded
> transaction may successfully commit during the receipt retention period.

---

## Contents

- [The guarantee](#the-guarantee)
- [Identity and keys](#identity-and-keys)
- [Timing, expiry and cleanup](#timing-expiry-and-cleanup)
- [Costs](#costs)
- [Compatibility](#compatibility)
- [Operations](#operations)
- [Security and reporting](#security-and-reporting)

---

## The guarantee

### 1. Is this "exactly once"?

No. It is **at most once** — specifically, at-most-once successful execution of a guarded
logical intent **within the retention period**.

The difference matters in both directions:

* CommitOnce prevents a second execution. It does **not** make the first one happen. If a
  transaction fails to land, the guard does nothing about that; retrying until success is
  still your job.
* The protection is bounded by the retention window. After the receipt expires *and* is
  closed, the key is free and a rebuilt duplicate can execute again.

Combined with ordinary retry-until-success, the pair produces exactly-once-style
*application* semantics. That composition is the product. Any description that drops "at
most" or "within the retention period" is wrong, and the repository says so in the program
doc comment, [`ARCHITECTURE.md`](./ARCHITECTURE.md) §2 and
[`SECURITY_MODEL.md`](./SECURITY_MODEL.md) §1.

### 2. What happens if the transaction fails after the `claim`?

Nothing bad. The whole transaction is rolled back, including the receipt creation and the
rent transfer. There is no state in which a receipt exists without its business action
having committed, so a failed attempt stays retryable — the key is not poisoned.

Only the transaction fee is spent. The rent deposit comes back with the rollback. The test
`downstream_failure_rolls_back_the_receipt` asserts exactly that: the receipt does not
exist, the business action's effect is absent, and the authority's balance decreased by
precisely the fee.

### 3. What if two attempts for the same intent land at the same time?

At most one commits. The receipt PDA is a single account, and the runtime serialises writes
to it. The first attempt to commit creates it; every other attempt's `claim` then finds an
existing account and fails the transaction — with `AlreadyCommitted` (6000) if the payload
matches, `IdempotencyConflict` (6001) if it does not. If two are genuinely simultaneous, the
loser may instead fail on the runtime's account lock (the account is already being written),
but in no case do both commit.

The test `only_the_first_of_many_attempts_commits` builds five distinct, independently
valid attempts (each with a different priority fee, so each is a distinct signed
transaction), all against **one** blockhash, and asserts that exactly one succeeds and the
business action executes once. Because they share a blockhash they are processed at one slot,
so that is the same-slot case.

The simultaneous case is also exercised on a live cluster.
[`apps/demo/concurrent-claim.ts`](../apps/demo/concurrent-claim.ts) fires 5–8 competing
transactions at real devnet validators without awaiting any of them, and gets the same result:
exactly one commits and the rest fail onchain with `AlreadyCommitted` (6000). The raw output is
in [`submission/evidence/devnet-contention-run.log`](../submission/evidence/devnet-contention-run.log).

One caveat, stated rather than buried: in every live run so far the attempts landed across
**two or three slots**, not one — the winner lands alone in an earlier slot and the losers pack
into the next. A slot's leader decides what to pack and a client cannot force two transactions
into one slot, so the live test demonstrates contention on a real cluster, and the same-slot
case rests on the in-process test. The two are not the same experiment.

### 4. Does CommitOnce replace Solana's own duplicate detection?

No, and it deliberately does not interfere with it. A byte-identical rebroadcast is still
rejected by the runtime's status cache with `AlreadyProcessed`, because the message hash is
unchanged. The two layers are complementary: the status cache protects *signed bytes*,
CommitOnce protects *the logical intent*. The test
`identical_rebroadcast_still_rejected_by_the_runtime` pins that CommitOnce does not change
the runtime's behaviour.

---

## Identity and keys

### 5. Can someone else block my key?

No — not by learning it. The authority is part of the receipt PDA derivation, so a third
party who knows your namespace and key exactly derives a *different* address. Their claim
lands on their own receipt and leaves yours untouched. The property is enforced by the
program's `seeds`/`bump` constraint, so it holds by construction rather than depending on
you remembering to hash your own pubkey into the key. The test
`third_party_cannot_consume_another_authoritys_key` has an attacker front-run the victim
with the identical namespace and key, and the victim's subsequent claim still succeeds.

Three caveats:

* **Whoever controls the authority can block you.** The authority *is* the identity. That is
  unavoidable.
* **Sharing an authority shares a key space.** If several tenants, services or team members
  sign with one key, any of them can consume a key under it. Namespaces separate names, not
  trust.
* **Anyone can close your expired receipt.** Cleanup is permissionless (the deposit still
  goes to your recorded destination). That does not block you — it ends your protection
  window, which is exactly what you configured the retention to be.

### 6. Can two different applications collide?

Yes, if they share an authority, a namespace *and* a key. The namespace exists to prevent the
common case: two features or two applications under one authority both using `order_928` do
not collide if their namespaces differ (`app_a:swap` vs `app_b:mint`), which
`same_textual_key_under_different_namespaces_does_not_collide` asserts. The namespace and key
hashes also use distinct domain separators, so a namespace hash can never equal a key hash —
an application cannot shadow another's key space by choosing a colliding string.

But there is **no namespace registry**. A namespace is a caller convention. If two systems
under the same authority pick the same namespace and the same key, they will collide by
design, and the collision will surface as `AlreadyCommitted` or `IdempotencyConflict`
depending on whether the payloads match.

### 7. Can I use one authority for many users or tenants?

You can, and it is a common shape (one ops wallet, one relayer, one custodial key), but
understand what it means:

* Every receipt is scoped to that one authority, so all tenants share one key space. A bug
  or a malicious caller in one tenant can consume a key belonging to another.
* The rent deposit for every receipt comes out of that one account.
* Per-user isolation requires per-user authorities. If a user's own key is the authority, no
  other user can affect their receipts.

If you must share one authority, give each tenant its own namespace and treat the key as
`<tenant>:<entity>:<id>` so collisions are impossible rather than merely unlikely.

### 8. What if I lose the idempotency key — or never persisted it?

The receipt still protects the *committed* intent: any attempt with a key you cannot
reconstruct simply isn't matched to it. But you can no longer ask "did this already
happen?", which is the entire point.

You cannot recover the key from the chain: the receipt stores `namespace_hash` and
`idempotency_key_hash`, not the strings. You *can* observe that some receipt exists at an
address you derive, but you cannot enumerate keys you never recorded. So: derive the key
from a domain identifier (an order id), or generate it once and persist it before the first
send.

### 9. Is my idempotency key or payload private?

No. Everything on the receipt is public chain state: the authority, the namespace hash, the
key hash, the payload hash, the refund destination, both creation timestamps, both
deadlines — and `IntentCommitted` emits the same fields as an event.

Hashes are not reversible, but they are *verifiable*: anyone who can guess your key or your
payload can hash the guess and compare. So:

* Do not put secrets (tokens, PII you would not publish, internal identifiers you consider
  confidential) into the key or the payload.
* The receipt address itself is derived from `(authority, namespace, key)`, so anyone who
  knows those three values can derive the address, check whether it exists, and read
  `created_slot` — i.e. they can confirm that your intent committed and roughly when.

The fingerprint is a *commitment*, not an encryption. Treat it as public.

---

## Timing, expiry and cleanup

### 10. What happens after the receipt expires?

Expiry alone changes almost nothing, and this is the most commonly misunderstood part:

* **An expired receipt still blocks.** It is still an account, so a later `claim` for the
  same tuple still finds it and still fails the transaction with `AlreadyCommitted`.
* **Expiry only makes cleanup permitted.** Once *both* the slot deadline and the wall-clock
  deadline have passed, `close_receipt` succeeds.
* **Closing ends the protection.** After the account is closed, the same
  `(authority, namespace, key)` can be claimed again and a rebuilt duplicate can execute
  again. This is deliberate, documented, and asserted by
  `closing_frees_the_key_for_a_new_claim`.

In practice: run a keeper that closes expired receipts (reclaiming the rent), and treat
"protected" as exactly "the receipt exists".

### 11. Can I close a receipt early to free the key or get the rent back?

No. `close_receipt` requires **both** deadlines to have passed — the monotonic slot deadline
(`created_slot + retention × 4`) *and* the wall-clock deadline
(`created_unix_ts + retention`). Before that it fails with `ReceiptNotExpired` (6009), and
the receipt is untouched. There is no admin override, no authority-only early close and no
cancel instruction.

`receipt_cannot_be_closed_before_expiry` checks each gate in isolation: passing the wall
clock while the slot deadline is unmet still fails, and vice versa.

### 12. Why is the minimum retention one hour, and not one minute?

Because a signed transaction built on a recent blockhash stays executable for roughly
`MAX_PROCESSING_AGE` slots — about **38 seconds** at mainnet's 250 ms slots. If a receipt
could be cleaned up inside that window, a still-valid signed duplicate could execute *after*
cleanup, silently reopening the duplicate window. One hour is nearly two orders of magnitude
longer, so no accepted configuration allows cleanup to outrun a live duplicate.
`retention_below_minimum_is_rejected` asserts that `1s`, `60s` and `3599s` are all refused
with `InvalidRetention` (6003).

### 13. What is the maximum retention?

`31,536,000` seconds — 365 days — inclusive. Anything above it is rejected with
`InvalidRetention` (6003), including `u64::MAX`. If you need longer than a year, use `0`
(**permanent**), which is the only value outside the `[3600, 31536000]` range that is
accepted.

Note what permanent means: the receipt never expires and **can never be closed**, so the
1,676,400-lamport deposit is never refunded and the key is never reusable. That is a
deliberate one-way door, not an oversight.

### 14. What if the receipt is closed while a duplicate is still valid?

It cannot happen under an accepted configuration. A receipt becomes closable only after both
deadlines pass, and the minimum finite retention is one hour — about 95× the ~38-second
blockhash window. So a blockhash-based duplicate is long dead before cleanup is permitted.
For durable-nonce transactions the concern is real (the duplicate never expires), which is
why those transactions are refused unless retention is permanent — see question 32.

### 15. What if I stop closing receipts?

Nothing breaks; you just keep paying for it. The deposit stays in each receipt account, the
receipt keeps blocking its tuple, and the protection window effectively extends indefinitely
because the key is never freed. At 1,676,400 lamports per receipt that adds up: 10,000
unclosed receipts hold about 16.8 SOL.

---

## Costs

### 16. What does it cost?

| Item | Value |
| --- | --- |
| Receipt account | 202 bytes |
| Rent deposit per live receipt | **1,676,400 lamports** (~0.00168 SOL) |
| Refunded on cleanup | the full deposit, after both deadlines, to the recorded destination |
| Permanent receipt | 1,676,400 lamports, never refunded |
| Extra accounts per guarded transaction | 1 writable PDA (the receipt) + 2 read-only system accounts |
| `claim` instruction data | 144 bytes |
| Transaction fee, priority fee | whatever the network and your client already pay — unchanged by CommitOnce |
| Compute units | **not quoted here**; measure them, see below |

The deposit is `(202 data bytes + 128 account overhead) × 5080 lamports/byte`, at the
mainnet rate in effect since **SIMD-0437 step 2** (epoch 1033). It is not hardcoded: `claim`
calls `Rent::get()?.minimum_balance(202)`, so it follows the cluster's own rent sysvar.

The `solana-rent` Rust crate still ships `DEFAULT_LAMPORTS_PER_BYTE_YEAR = 3480` with
`DEFAULT_EXEMPTION_THRESHOLD = 2.0`, i.e. an effective **6960 lamports/byte** — **37% higher**
than the live mainnet rate. Any rent figure derived from that crate overstates the deposit by
more than a third. (The Rust test harness overrides the `SysvarRent` sysvar with live mainnet
values for exactly this reason, and asserts the deposit is `1,676,400`.)

For compute units, run the measurement instead of trusting a number:

```bash
bash scripts/test.sh --test benchmarks -- --nocapture
```

It prints measured compute units for the bare business action, `claim` alone, a guarded
first attempt, a blocked duplicate and cleanup, plus the measured wire-size and account
deltas, the receipt data length and the measured deposit.

### 17. Is the rent deposit charged per attempt or per intent?

Per intent — specifically, per receipt created. A retry that is blocked by the guard creates
nothing, so it costs only its transaction fee. If a downstream instruction fails, the deposit
is rolled back with everything else. You pay the deposit once, when an intent first commits,
and you get it back when its receipt is closed.

### 18. What if I lose the refund destination?

The deposit is unrecoverable, and there is nothing to be done about it after the fact.

`refund_destination` is written into the receipt at claim time and is **immutable**.
`close_receipt` constrains the receiving account to that recorded value
(`address = receipt.refund_destination`), which is precisely what makes permissionless
cleanup safe: nobody can redirect the deposit, including you. So if the recorded destination
is a keypair you lost, or an account that no longer exists, then when the receipt is closed
the lamports go there anyway.

What you can and cannot do:

* **You can still close the receipt** — anyone can, after both deadlines, and it will succeed.
  The deposit simply lands in the address you recorded.
* **You cannot redirect it**, not even with the authority's signature. There is no
  admin path, no "update destination" instruction, and no way to re-point an existing
  receipt.
* **The receipt stays on chain until someone closes it**, holding the deposit.

So choose the destination deliberately at claim time. Good choices: the authority itself
(the SDK's default when you omit `refundDestination`), a treasury address you control, or a
PDA you can always sign for. Bad choices: a fresh throwaway keypair, a burn address, a
destination you cannot verify, or the receipt PDA itself — the last two are rejected outright
by the program with `InvalidRefundDestination` (6004), which is why
`refund_destination_cannot_be_the_default_pubkey` and
`refund_destination_cannot_be_the_receipt_itself` exist as tests.

If you are not sure, use the authority: it already has to exist and sign for the claim to
work at all.

---

## Compatibility

### 19. What if my program is not Anchor?

It does not matter. CommitOnce is a **separate instruction in the same transaction**, so your
program does not integrate with it, import it, or even know it exists. The `demo-counter`
program in this repository is the proof: it is a plain business program whose only role is to
increment a counter, and the test `guard_is_transparent_to_the_business_instructions` asserts
it produces its normal effect once the guard has passed.

The same applies to a native (non-Anchor) program, a Pinocchio program, or a CPI chain: the
guard is just the first instruction in the transaction.

The CommitOnce program *itself* is Anchor-built, so its errors are Anchor custom codes
(6000–6010), and Anchor framework constraint failures use Anchor's own error range. That is
a property of the guard program, not a requirement on yours.

### 20. Does it work with v0 transactions?

Constructing and signing a v0 message with the guard is verified: the SDK's own examples use
`createTransactionMessage({ version: 0 })`, and building a v0 message containing
`[guard.instruction, businessInstruction]` with `@solana/kit` 8.3.0 — then signing it — was
checked against the built SDK, with the guard correctly at index 0.

What is **not** tested is executing a v0 transaction that contains the guard against a real
SVM: the Rust suite submits legacy (non-versioned) messages through LiteSVM. The program has
no code path that reads the message version, so there is no reason to expect a difference,
but "no reason to expect" is not "tested". If v0 is on your critical path, run your own
integration test before relying on it.

### 21. Does it work with transaction v1?

**Untested, and not claimed.** Nothing in this repository builds, submits or tests a
transaction v1 message, and no documentation here should be read as asserting support.

What can be said from the source: the program reads the Instructions sysvar, which is a
runtime-provided view of the transaction's instructions, and its own logic depends only on
instruction data, account addresses and account ownership — not on the message format. The
one place where message semantics matter is the durable-nonce policy, which detects the
*presence* of a System Program `AdvanceNonceAccount` instruction. If a future transaction
version changes how durable nonces are expressed or how the instructions sysvar reflects
them, that check is where the behaviour would change. There is no test for v1, so treat v1
as unverified and write your own test if you need it.

### 22. Does it work with versioned transactions and address lookup tables?

The guard's accounts are ordinary instruction account metas (authority, receipt, the
Instructions sysvar, the System program), so any message builder — including one that
compresses accounts with a lookup table — can place them. A lookup table only changes how
account keys are *encoded* in the message; it does not change instruction data, account
roles, or the on-chain `seeds` constraint. So it cannot be used to bypass the guard.

Two practical notes:

* The **receipt PDA is per intent**. It is deterministic before the claim, but there is one
  per `(authority, namespace, key)`, so putting it in a static lookup table is not useful —
  you would need a table entry per intent.
* The **authority must be a signer**, so it is a static account key in the message regardless
  of table usage.

No test in this repository uses address lookup tables, so the combination is unverified in
practice even though nothing in the design blocks it.

### 23. Can I use the SDK from a `@solana/web3.js` codebase?

The SDK's `Instruction` objects come from `@solana/kit` (a peer dependency), so a legacy
`@solana/web3.js` codebase has to translate them. The translation is mechanical, because the
instruction is plain data plus four account metas:

| Kit field | web3.js equivalent |
| --- | --- |
| `instruction.programAddress` | `programId` (base58 string) |
| `instruction.data` | `data` (the same 144 `Uint8Array` bytes) |
| `accounts[].address` | `AccountMeta.pubkey` |
| `accounts[].role` | `0` = read-only, `1` = writable, `2` = read-only signer, `3` = writable signer → `isSigner` / `isWritable` |

For `claim` the four accounts are, in order: authority (`3`), receipt (`1`), Instructions
sysvar (`0`), System program (`0`). Alternatively, build the bytes yourself from the layout
in [`API_REFERENCE.md`](./API_REFERENCE.md) §2.3 and the two domain-separated hashes in §9.2 —
the wire format is fixed-size, hand-encoded and pinned by tests precisely so that it can be
implemented in another language.

### 24. Can a program-derived address (PDA) be the authority? Can a Squads vault?

`claim` requires `authority` to be a `Signer`, so a PDA cannot sign for itself directly. A PDA
authority works only if a program signs for it through CPI — i.e. your program (or a wrapper)
invokes `commit_once::claim` with `invoke_signed` using the PDA's seeds. That is a
straightforward pattern in principle, but **there is no such integration in this repository
and no test for it**. If you build one, note that the CPI caller becomes responsible for the
guard's ordering and for passing the right accounts, which is exactly the kind of code the
prepend-an-instruction design lets you avoid.

A Squads vault is a PDA, so the same answer applies: the vault's address *can* be the
authority, but only through a CPI that signs for it. [`ARCHITECTURE.md`](./ARCHITECTURE.md)
§11 states the consequence plainly: **there is no multisig or threshold authority today**, and
per-member keys cannot share a single receipt — each key is its own authority with its own
receipt.

---

## Operations

### 25. How is this different from a database idempotency key?

They solve the same problem at different layers, and the difference is atomicity.

| | Database idempotency key | CommitOnce receipt |
| --- | --- | --- |
| Where the check happens | your server, before sending | on chain, in the same transaction as the action |
| Atomic with the action | no — classic dual-write problem: the DB write and the send can disagree | yes — the check and the action commit or revert together |
| Survives a crash between check and send | no | yes, because there is no "between" |
| Visible to the chain | no | yes |
| Works across processes, regions and languages | only if they share the database | yes, it is chain state |
| Prevents a rebuilt transaction from landing | no | yes, within the retention window |
| Cost | a row | 1,676,400 lamports per live receipt, refunded on cleanup |
| Bounded by | your data retention policy | the retention window you chose |

A database key still has a real failure mode: process A writes the key, then crashes before
sending; or sends, then crashes before recording the outcome. CommitOnce removes the
write/send gap, but it is **not** a record of results — see question 26.

Keep both if you want: the receipt makes "has this intent committed?" a chain question, and
your database records what the outcome was.

### 26. Does the receipt tell me the result of my action?

No. The receipt tells you that the intent committed, and when (`created_slot`,
`created_unix_ts`). It does not store your program's return value, the amount actually
transferred, or any application state.

That matters in one specific case: if your process crashed after the commit but before
recording the outcome, a retry returns `AlreadyCommitted` and you know the action happened
but not what it produced. Recovery options: read the receipt to get the creation slot and
timestamp, then look up the transaction that created it and read its logs; or keep your own
outcome record keyed by the same idempotency key. The receipt is a guard, not a ledger.

### 27. Can I detect a duplicate before sending anything?

Yes, for the "has it already committed?" question: `client.inspect({ authority, namespace,
idempotencyKey, intent, clock })` returns `unclaimed`, `committed` or `expired`, plus
`matchesIntent` (`true` = a retry would be blocked as a duplicate; `false` = the key was used
for a different payload) and `closable`.

It is a read, not a lock, so a race remains: another attempt can commit between your
`inspect` and your send. That is fine — your send then fails with `AlreadyCommitted`, which
is the same outcome the check would have given you. `inspect` is a UX and preflight tool, not
a substitute for the guard.

### 28. Does `AlreadyCommitted` mean my business instructions ran?

Not in *this* transaction. The error aborts the transaction, so every instruction after the
guard is discarded. It means the intent committed **at some earlier point** — possibly in an
attempt whose response you never saw.

So `AlreadyCommitted` is a success signal for the intent and a no-op for this transaction.
Treat it as success in your retry loop; do not surface it as an error to the user, and do not
retry again.

---

## Security and reporting

### 29. Is it audited?

**No.** The program has had no independent review. [`SECURITY_MODEL.md`](./SECURITY_MODEL.md)
opens by saying so, and it lists the failure modes that would break the guarantee along with
the test that guards each one — but a self-authored test suite is not an audit, and a
security model written by the authors is a specification to be checked, not evidence.

If you are deploying this in front of real value, budget for a review, and start from
[`SECURITY_MODEL.md`](./SECURITY_MODEL.md) §8 ("failure modes that would break the
guarantee"), which is written to be reviewable rather than reassuring.

### 30. Where do I report a security issue?

There is **no published disclosure policy in this repository**. [`SECURITY_MODEL.md`](./SECURITY_MODEL.md)
points at a `SECURITY.md` at the repository root, but that file does not exist in this
checkout — so the intended channel is documented but not yet written.

What that leaves, in order of preference:

1. **GitHub private vulnerability reporting**, if it is enabled on the repository
   (`https://github.com/commitonce-dev/commitonce`, per `packages/sdk/package.json`). This is
   the correct channel for a security report, because it is private by default.
2. If it is not enabled, open a **minimal public issue asking for a private channel** — and
   nothing more. Do not post reproduction steps, exploit details or affected deployments in
   a public issue or in any chat channel.
3. If neither is possible, do not publish details. A public report against an unaudited
   program with real deposits at stake is a live exploit for anyone reading it.

When reporting, the most useful things to include are: which invariant from
[`SECURITY_MODEL.md`](./SECURITY_MODEL.md) §1 you believe is violated, the exact accounts and
instruction data of a minimal failing transaction, and whether it is reproducible in LiteSVM
(the test harness in `programs/commit-once/tests/` shows how to drive the compiled program
directly).

### 31. If I stop using CommitOnce, is there a lock-in?

No. The guard is one instruction in your client, and nothing in your program references it:

* Remove the `prepareIntent` call and the `guard.instruction`, deploy, and your application
  behaves exactly as it did before.
* No state in your program is modified by CommitOnce, and no account of yours is owned by it.
* The program can stay deployed; unused, it is inert.

What remains on chain is the receipts you created:

* Each holds 1,676,400 lamports until it is closed. Cleanup is permissionless and the deposit
  always returns to the destination recorded at claim time, so a rollback can reclaim
  everything without the authority being online.
* Each receipt keeps blocking a `claim` for its tuple until it is closed. If you stop
  claiming, that is inert.
* **Permanent receipts are the exception**: they can never be closed, so their deposit is
  never refunded and their key is never reusable. That is the one part of a rollback you
  cannot undo. Choose `permanent` only when you mean it.

[`INTEGRATION_PLAYBOOK.md`](./INTEGRATION_PLAYBOOK.md) §10 has the rollback procedure,
including the keeper loop that closes expired receipts.

### 32. Why not just use a durable nonce?

Because a durable nonce solves a different problem. A nonce makes a *signed transaction*
stay valid indefinitely; it says nothing about the identity of the *intent*. To retry you
must re-sign against the current nonce value, which produces a different transaction, and the
network has no way to connect the two.

More importantly, the two mechanisms interact badly, and the program refuses the unsafe
combination. A durable-nonce transaction never expires, so an old signed duplicate stays
executable forever; if its receipt could be cleaned up, cleanup would reopen the duplicate
window permanently. So `claim` inspects the Instructions sysvar for a System Program
`AdvanceNonceAccount` instruction (discriminator `u32` LE `4`) and rejects the transaction
with `DurableNonceUnsupported` (6002) **unless `retention_seconds == 0`**. Permanent receipts
have no cleanup path, so they are safe with nonces and are explicitly supported.

If you want both, use `retention: 'permanent'` and accept that the deposit is never refunded.
Tests: `durable_nonce_transaction_is_rejected_for_finite_retention`,
`durable_nonce_transaction_is_allowed_for_permanent_retention`, and
`ordinary_transactions_are_not_mistaken_for_nonce_transactions` (which guards against an
over-eager check breaking normal integrations).

One honest limitation on those tests: the harness cannot construct a transaction that the
*runtime* classifies as a nonce transaction (see the long comment in `tests/security.rs` for
why). What it tests is the program's deliberately stricter behaviour — the **presence** of
the marker instruction triggers the policy. That is a superset of the real condition, so the
policy is exercised, but the runtime-classification path itself is not.

### 33. Why not just retry with the same blockhash?

Because the identical-rebroadcast trick only covers a ~38-second window and forces you to
give up every lever a client normally uses.

* Re-submitting the **byte-identical** transaction is genuinely deduplicated by the runtime's
  status cache (`AlreadyProcessed`), because the message hash is unchanged. That is the case
  CommitOnce does not need to handle, and it keeps working.
* But a blockhash is only valid for roughly `MAX_PROCESSING_AGE` slots — about 38 seconds at
  mainnet's 250 ms slots. After that, the signed transaction is dead and you *must* rebuild,
  which changes the message bytes and therefore the signature. No deduplication applies.
* Rebuilding is also what you want to do: raise the priority fee, change the compute budget,
  use a different route or provider. All of those change the bytes.
* And holding the same blockhash across retries is not something a normal client can do
  reliably — it must be preserved deliberately, and most retry helpers fetch a fresh one.

So "just retry with the same blockhash" works only while you never rebuild and never change a
fee, in a window of about 38 seconds. CommitOnce covers the rebuild, which is the case that
actually causes double execution. The test
`without_guard_two_rebuilt_transactions_execute_twice` demonstrates the failure it addresses:
two rebuilt transactions, both landing, the action happening twice.

### 34. Why should the guard be in the same transaction instead of a separate "lock" call?

Because a separate call has a window in which the receipt exists but the action has not
happened. If the client crashes, is killed, or the second transaction fails, the key is
poisoned: the receipt exists, the action never happened, and every retry is refused as a
duplicate. Unlocking it requires a compensating action, which is itself a distributed-systems
problem. You would also pay two fees and two round trips per guarded action.

The reverse order is worse: act first, claim second, and the duplicate has already executed
by the time the guard notices. Putting the guard after the business instructions *within* one
transaction would still be safe, because any failure reverts everything — but prepending it
makes the failure attribution unambiguous (an error at index 0 is the guard) and is the
ordering every test exercises. See [`CONCEPTS.md`](./CONCEPTS.md) §10.

### 35. What is the single biggest way an integrator can weaken the guarantee?

Putting something that changes on every rebuild into the payload fingerprint. If the
fingerprint includes the blockhash, the priority fee, the compute budget, a retry counter, or
anything derived from the attempt, then a retry computes a *different* fingerprint for the
same key — and the program reports `IdempotencyConflict` instead of `AlreadyCommitted`.
Depending on how you handle that error, you either drop a legitimate retry or, worse, treat
the conflict as "new intent" and execute the action twice.

The rules are in [`INTEGRATION_PLAYBOOK.md`](./INTEGRATION_PLAYBOOK.md) §5. The short version:
the fingerprint covers what the action *is* (recipient, amount, mint, memo, invoked programs)
and nothing about how it was *transported*.
