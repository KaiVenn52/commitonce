# CommitOnce integration playbook

How to add CommitOnce to an **existing** Solana application without breaking it.

Read [`CONCEPTS.md`](./CONCEPTS.md) first if the vocabulary is new; the reference for every
symbol used here is [`API_REFERENCE.md`](./API_REFERENCE.md). The program is **unaudited**.

The shape of the change is small: **one extra instruction, prepended to a transaction you
already build.** There is no program change, no account migration, no new dependency in
your onchain code, and nothing your downstream program needs to know about. What follows is
everything that is *not* small: choosing keys, choosing a window, and making sure no code
path quietly bypasses the guard.

---

## 1. The one rule

The guard and the business instructions must be in the **same atomic transaction**, and the
**authority must be a signer of that transaction**.

Everything else in this document is downstream of that sentence:

* If the guard is in a different transaction, you have replaced a duplicate-execution bug
  with a poisoned-key bug (see [`CONCEPTS.md`](./CONCEPTS.md) §10).
* If the authority is not a signer, the transaction fails: the authority pays the rent
  deposit, and the receipt PDA's `seeds` constraint binds the address to that signer. A
  relayer may pay the *fee*; the authority still has to sign.
* If the transaction is already signed, you cannot patch it. A signature covers the message,
  so adding an instruction invalidates it. Rebuild and re-sign. That means the guard must be
  inserted **before** signing — in the builder, not in the submitter.

### What changes, and what does not

| | |
| --- | --- |
| **Changes** | one extra instruction (144 bytes of data, 4 accounts) and one writable PDA in the account list; the authority becomes a signer and a rent payer; the transaction pays one rent deposit the first time an intent commits |
| **Does not change** | your program's code, accounts, IDL or state; your fee payer; your compute budget (though the guard does consume compute units — measure with `bash scripts/test.sh --test benchmarks -- --nocapture`); your retry loop's structure; the behaviour of byte-identical rebroadcasts, which the runtime still deduplicates |

---

## 2. Where to insert the guard in an existing transaction builder

The insertion point is wherever your instruction list is final and **before** you sign. The
guard is `guard.instruction` from `prepareIntent`, and it goes first.

### 2.1 `@solana/kit` builder (`pipe`)

Before:

```ts
const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => appendTransactionMessageInstructions(businessInstructions, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
);
```

After — one line inserted:

```ts
const guard = await prepareIntent({
    authority,                       // must be a signer of this transaction
    namespace: 'payments:transfer',
    idempotencyKey: orderId,
    intent: { to, mint, amount },
    retention: '24h',
});

const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => appendTransactionMessageInstructions(
        [guard.instruction, ...businessInstructions],   // <- guard first
        m,
    ),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
);
```

If `authority` is not the fee payer, it must still sign. The PDA derivation requires the
authority's signature, not merely its address. Attach it as an additional signer before
signing:

```ts
import { addSignersToTransactionMessage } from '@solana/kit';

const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),   // pays the fee
    (m) => appendTransactionMessageInstructions([guard.instruction, ...businessInstructions], m),
    (m) => addSignersToTransactionMessage([authority], m),      // signs, and pays the rent
    (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
);
```

### 2.2 A builder that returns an instruction array

```ts
function buildPaymentInstructions(order: Order, authority: Address): Instruction[] {
    return [ /* … existing business instructions … */ ];
}

// Callers change; the function does not have to.
async function buildGuardedPayment(order: Order, authority: Address, authoritySigner: TransactionSigner) {
    const guard = await prepareIntent({
        authority,
        namespace: 'payments:transfer',
        idempotencyKey: `order:${order.id}`,
        intent: { to: order.recipient, mint: order.mint, amount: order.amount },
        retention: '24h',
    });
    return [guard.instruction, ...buildPaymentInstructions(order, authority)];
}
```

### 2.3 A single chokepoint (recommended)

The most reliable integration is not "add a line everywhere" but "make it impossible to
send without the guard". Introduce one function that is the only way your codebase builds a
transaction that touches guarded state, and put the guard inside it:

```ts
async function buildGuardedTransaction(args: {
    authority: TransactionSigner;
    feePayer: TransactionSigner;
    namespace: string;
    idempotencyKey: string;
    intent: CanonicalIntent;
    retention?: Retention;
    instructions: readonly Instruction[];
    latest: { blockhash: Blockhash; lastValidBlockHeight: bigint };
}) {
    const guard = await prepareIntent({
        authority: args.authority.address,
        namespace: args.namespace,
        idempotencyKey: args.idempotencyKey,
        intent: args.intent,
        retention: args.retention,
    });

    const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(args.feePayer, m),
        (m) => appendTransactionMessageInstructions([guard.instruction, ...args.instructions], m),
        (m) => addSignersToTransactionMessage([args.authority], m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(args.latest, m),
    );

    assertGuarded(message); // see §7.3
    return { guard, message };
}
```

Then review every remaining `sendTransaction` / `sendAndConfirm` call site. Each one is
either routed through this function or is a deliberate, documented exception.

### 2.4 Wallets, relayers and offline signers

`prepareIntent` is pure: it needs no RPC, prover or indexer. That is what makes it usable in
a wallet (build the guard locally, show the user the receipt address and retention), in a
relayer (prepend the guard to a partially-signed transaction before the authority signs),
and in an offline signer. The constraint is unchanged: the authority must sign *after* the
guard is in the instruction list, so an offline flow has to hand the authority a message
that already contains the guard.

### 2.5 Where the guard must *not* go

* **Not in a second transaction.** See §1.
* **Not after signing.** The signature would be invalid.
* **Not with a different authority than the one that signs.** The seeds constraint will
  reject it (or worse, derive an address nobody claims).
* **Not with a rebuilt payload.** If the payload differs between attempts, the retry becomes
  `IdempotencyConflict` instead of `AlreadyCommitted`. See §5.

Ordering *within* the transaction is not load-bearing for atomicity: if any instruction
fails, the whole transaction reverts, so putting the guard second would still prevent the
duplicate from committing. Prepend it anyway — the failure attribution is then unambiguous
(an error at index 0 is the guard), the log order is legible, and it is the ordering every
test in this repository exercises.

---

## 3. Choosing a namespace

A namespace scopes a key space. It is a plain string, hashed with the key's own domain
separator so a namespace can never alias a key.

Rules that hold up in production:

1. **Make it stable forever.** Changing a namespace changes the receipt address, so
   receipts created under the old namespace stop protecting the new claims. Treat it like a
   table name in a database you can never rename.
2. **Scope it to the action type, not the tenant alone.** `payments:transfer`,
   `payouts:batch`, `jobs:settle`, `mints:claim`. Two different action types under one
   namespace with the same key is a conflict, not a duplicate.
3. **Include the product or tenant if one authority serves several.** `product_a:swap` and
   `product_b:swap` never collide, which matters if both run under the same ops wallet.
4. **Do not put per-intent data, timestamps or versions in it.** `payments:transfer:v2`
   looks harmless and silently orphans every receipt written under `payments:transfer:v1`.
5. **Do not rely on it for security.** There is no registry. Two systems under the *same*
   authority that choose the *same* namespace and key will collide, by design. Namespaces
   separate names; the authority is the security boundary.

A useful convention is `<product>:<resource>` or `<product>:<resource>:<verb>`:

| Namespace | Meaning |
| --- | --- |
| `payments:transfer` | outbound payment |
| `payments:refund` | refund for an order |
| `payouts:batch` | a payout run |
| `jobs:settle` | a scheduled settlement |
| `mints:claim` | a one-time mint claim |

You do not need a namespace per cluster: devnet and mainnet are separate ledgers.

---

## 4. Deriving an idempotency key from existing domain identifiers

The key is the identity of the logical intent. It must be:

* **stable** across every attempt, process, deploy and retry — including retries a week
  later, after a crash, from a different worker;
* **unique per intent** — two different actions must never share it;
* **decided before the first send**, and persisted if it cannot be recomputed.

### 4.1 Use what you already have

You almost always have a natural identifier. Prefix it with the entity type so that two
different entities with the same numeric id cannot collide:

| Domain identifier | Key | Why |
| --- | --- | --- |
| order id `928` | `order:928` | the order is the intent |
| payment id `ch_3Px…` | `pay:ch_3Px…` | a payment attempt that can be retried independently of its order |
| job id `42`, settlement | `job:settle:42` | distinguishes a job's settlement from its other effects |
| subscription `17`, October 2026 | `sub:17:2026-10` | the intent is one billing period, not the subscription |
| payout batch `7` on 2026-10-01 | `batch:2026-10-01:7` | a batch is an intent; its individual transfers are not |
| user `alice`, daily claim | `claim:alice:2026-10-01` | the intent is the day's claim |

If a *legitimate* repeat of the same logical action is possible — a monthly renewal, a
daily claim — the key **must** include the period. Otherwise the second month is refused as
`AlreadyCommitted`.

### 4.2 If there is no natural identifier

Generate one **before the first attempt** and persist it:

```ts
// Generate once, store in your database, reuse on every retry.
const idempotencyKey = `order:${orderId}`; // or `uuid:${crypto.randomUUID()}` if there is no id
await db.orders.update({ id: orderId }, { commitOnceKey: idempotencyKey });
```

`crypto.randomUUID()` is fine as a *source*, but only if it is generated once and stored. A
key generated per attempt protects nothing.

### 4.3 What must never go into a key

| Ingredient | Why it breaks |
| --- | --- |
| attempt number, retry counter | makes each attempt a different intent — the guard protects nothing |
| timestamp of this attempt | same problem |
| the transaction signature | not known before signing, and different on every rebuild |
| the blockhash | different on every rebuild |
| a fresh UUID per attempt | same as the attempt number, with extra steps |
| the payload's own hash | fine, but redundant — the key must be *derivable from the domain*, not from the bytes you are trying to stabilise |

Also note the failure mode of reusing a key for a genuinely different action: you get
`IdempotencyConflict` (6001), not a duplicate. That is deliberate — see §8.

---

## 5. What to include in the payload fingerprint

The payload fingerprint defines "the same intent". It is the most likely place for an
integrator to weaken the guarantee, so the rules are explicit.

### 5.1 Include / exclude

| Include (semantic) | Exclude (transport) |
| --- | --- |
| recipient / destination address | blockhash |
| amount (as `bigint` or a decimal string) | signature |
| mint or token identity | priority fee, compute budget |
| memo, reference, order id | retry count, attempt id |
| program ids being invoked | submission route, RPC URL |
| the chain id or cluster, *if* you want them separated | anything you compute from the attempt itself |

### 5.2 A worked example

```ts
const intent = {
    to: order.recipient,
    mint: order.mint,
    amount: order.amount,          // bigint, not a float
    memo: `order:${order.id}`,
    program: TOKEN_PROGRAM_ADDRESS,
};

const guard = await prepareIntent({
    authority,
    namespace: 'payments:transfer',
    idempotencyKey: `order:${order.id}`,
    intent,
    retention: '24h',
});
```

Two attempts of the same order produce identical bytes, even if the object is written in a
different key order, because the canonical encoding sorts keys. Verified in
[`QUICKSTART.md`](./QUICKSTART.md) Path A step 4.

### 5.3 Encoding rules that will bite you

| Rule | Consequence if ignored |
| --- | --- |
| Amounts must be `bigint` or a decimal string | floating-point numbers are not decimal-exact; `0.1 + 0.2` style drift changes the fingerprint |
| `undefined` throws | `{ a: undefined }` is rejected rather than silently dropped, because dropping it could hide a conflict |
| `Date`, `Map`, `Set` throw | convert them to a string or a plain object first |
| Non-finite numbers throw | `NaN`/`Infinity` have no canonical encoding |
| Object key order does not matter | — |
| **Array order does matter** | `[a, b]` and `[b, a]` are different intents; sort arrays of accounts/recipients if order is not semantic |
| A 32-byte `Uint8Array` is taken as a precomputed fingerprint | to hash raw bytes as content, wrap them: `{ data: bytes }` |

### 5.4 The migration hazard nobody expects

**Changing the payload shape changes the fingerprint for the same key.** If you add a field
to the intent object and deploy while receipts from the previous shape are still live, a
retry of an *already committed* intent stops returning `AlreadyCommitted` and starts
returning `IdempotencyConflict` — because the same key now maps to a different fingerprint.

Two safe ways to handle a payload change:

1. **Keep the payload shape frozen for at least the retention window** of the receipts you
   have already written, and deploy the change after they have expired and been closed.
2. **Bump the namespace** as part of the same release (`payments:transfer` →
   `payments:transfer:2`), which gives the new shape a fresh key space. The old receipts keep
   blocking their own keys until they are closed, and the new code never collides with them.

Option 2 is usually the right one, and it is the reason a namespace should be treated as a
long-lived identifier rather than a label.

---

## 6. Choosing a retention value

Retention is the length of the protection window: `0` (permanent), or `3600`–`31536000`
seconds. The default is 24 hours.

### 6.1 How to choose

1. **Estimate your maximum retry horizon.** Not the happy-path timeout — the worst realistic
   case: a webhook redelivered the next morning, a queue redriven after an incident, an
   operator clicking "retry" after a support ticket, a client that was offline for a day.
2. **Add margin.** The receipt must outlive every attempt that could still carry the same
   intent.
3. **Pick the value.** Anything shorter than the horizon is a real duplicate-execution risk,
   because after cleanup the key is free again.
4. **Multiply by volume** to see the rent you are holding: 1,676,400 lamports per live
   receipt at mainnet rates. 10,000 live receipts ≈ 16.8 SOL held until cleanup.

| Scenario | Reasonable starting point | Why |
| --- | --- | --- |
| Interactive payment, client retries for a minute | `1h` (the minimum) | the minimum already exceeds the ~38 s blockhash window by ~95× |
| API-driven payment with webhook redelivery | `24h` (the default) | covers next-day redelivery |
| Scheduled job or batch payout | `7d` | covers a weekend incident and a manual redrive |
| Anything that might be retried "at some point" | `30d`, or `permanent` | see the durable-nonce note below |
| Durable-nonce transaction | `permanent` only | the program rejects a finite window (6002) |

These are starting points, not recommendations: the correct value is a property of your
retry policy, and only you know it.

### 6.2 Two properties of the window that are easy to get wrong

* **Expiry is not cleanup.** An expired receipt still exists, so it still blocks. The window
  ends when someone *closes* it. Close expired receipts deliberately (a keeper, a cron job)
  if you want "protected" to mean exactly "the receipt exists" — otherwise your protection
  silently extends until a third party closes it for you.
* **Cleanup is permissionless.** Anyone may close an expired receipt, which ends your
  protection for that key. They cannot redirect the deposit, but they can shorten your
  window to the value you chose. Do not choose a retention you would not be comfortable
  seeing enforced to the second.

### 6.3 Permanent receipts are a one-way door

`retention: 'permanent'` means the receipt never expires and can never be closed. The
deposit is never refunded, and the key is never reusable — including during a rollback. Only
choose it if you genuinely need an unbounded window (or you are using a durable nonce), and
be aware that the only way out is to stop using that key and let the account sit there.

### 6.4 Retention is per claim, and nothing enforces consistency

The program accepts a different retention on every claim, including a shorter one for a
later intent under the same namespace. If you want a policy ("this namespace is always
24h"), enforce it in your own code — for example by having exactly one function that builds
guards, with the retention hardcoded per namespace.

---

## 7. Migrating an existing retry loop

The retry loop keeps its structure. Three things change.

### 7.1 Persist the key before the first attempt

```ts
// Before the loop, not inside it.
const idempotencyKey = order.commitOnceKey ?? `order:${order.id}`;
await db.orders.update({ id: order.id }, { commitOnceKey: idempotencyKey });
```

### 7.2 Build the guard inside the loop, from stable inputs

Every attempt must produce the same `namespace`, `idempotencyKey` and `intent`. Only the
transport may change — blockhash, priority fee, compute budget, route.

```ts
async function sendGuardedPayment(order: Order) {
    const authority = await getAuthoritySigner(order);
    const intent = { to: order.recipient, mint: order.mint, amount: order.amount };
    const idempotencyKey = order.commitOnceKey ?? `order:${order.id}`;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
            const guard = await prepareIntent({
                authority: authority.address,
                namespace: 'payments:transfer',
                idempotencyKey,
                intent,                          // same object, every attempt
                retention: '24h',                // same value, every attempt
            });

            const latest = await rpc.getLatestBlockhash().send();
            const message = pipe(
                createTransactionMessage({ version: 0 }),
                (m) => setTransactionMessageFeePayerSigner(feePayer, m),
                (m) => appendTransactionMessageInstructions(
                    [guard.instruction, ...buildTransferInstructions(order)], m),
                (m) => addSignersToTransactionMessage([authority], m), // authority signs too
                (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
            );

            const signed = await signTransactionMessageWithSigners(message);
            await sendAndConfirm(signed, { commitment: 'confirmed' });
            return { status: 'committed', signature: getSignatureFromTransaction(signed) };
        } catch (error) {
            if (isAlreadyCommitted(error)) {
                // The intent committed — either now, or before we lost the response.
                return { status: 'already-committed' };
            }
            if (isIdempotencyConflict(error)) {
                // Not a duplicate. The key was used for a different payload.
                throw new IdempotencyConflictError(idempotencyKey, order.id);
            }
            if (attempt === MAX_ATTEMPTS - 1) throw error;
            await sleep(backoff(attempt));
        }
    }
}
```

### 7.3 Make the guard's presence a runtime invariant

A cheap assertion catches the integration bug that matters most — a path that forgot the
guard:

```ts
import { COMMIT_ONCE_PROGRAM_ADDRESS } from '@commitonce/solana';

function assertGuarded(message: TransactionMessage): void {
    const first = message.instructions[0];
    if (first?.programAddress !== COMMIT_ONCE_PROGRAM_ADDRESS) {
        throw new Error(
            'Refusing to send: the CommitOnce guard is not the first instruction. ' +
            'This transaction is not protected against duplicate execution.',
        );
    }
}
```

Call it in the same function that signs. It costs nothing and it fails closed.

### 7.4 What the retry loop must not do

| Anti-pattern | Effect |
| --- | --- |
| Regenerating the key per attempt | every attempt is a new intent; nothing is deduplicated |
| Rebuilding the payload from mutable state (e.g. re-reading a price) | the fingerprint changes; retries become `IdempotencyConflict` |
| Changing the retention between attempts | a different receipt is claimed if the key is new; harmless if the key is the same, but it makes behaviour non-deterministic |
| Treating `AlreadyCommitted` as a hard failure | the caller retries forever on an intent that already succeeded |
| Reusing the same key for a different order | `IdempotencyConflict`; the second order never executes |
| Sending the business instructions from a path without the guard | no protection at all on that path |

---

## 8. Handling `AlreadyCommitted` vs `IdempotencyConflict`

Both arrive as custom program errors (6000 and 6001) nested inside whatever your RPC client
throws. `classifyError` normalises both the structured shapes and the `custom program error:
0x1770` message form.

| | `AlreadyCommitted` (6000) | `IdempotencyConflict` (6001) |
| --- | --- | --- |
| Meaning | this intent already committed | this key was used for a different payload |
| Severity | expected, benign | a bug or a genuinely different action |
| Action | treat as **success**; do not retry | **stop**; do not retry; alert |
| Retry? | no | no — retrying can never succeed while the receipt exists |
| State on chain | receipt unchanged | receipt unchanged; the original fingerprint is immutable |
| What to log | the receipt address, and that the action was skipped | the key, both payloads, and the call site |

```ts
const classified = classifyError(error);

switch (classified.kind === 'commit-once' ? classified.name : 'other') {
    case 'AlreadyCommitted':
        // The intent committed. The guarded instructions did NOT run a second time.
        return { status: 'committed' };

    case 'IdempotencyConflict':
        // Same key, different payload. Decide deliberately; never silently continue.
        alert('commit-once conflict', { key: idempotencyKey, orderId: order.id });
        return { status: 'conflict' };

    case 'DurableNonceUnsupported':
        // Use retention 'permanent', or drop the durable nonce.
        return { status: 'misconfigured' };

    case 'InvalidRetention':
    case 'InvalidRefundDestination':
        // Configuration bugs; the SDK rejects most of these before sending.
        return { status: 'misconfigured' };

    default:
        // Transport errors, blockhash expiry, program errors: retry per your policy.
        throw error;
}
```

### 8.1 The subtlety in `AlreadyCommitted`

`AlreadyCommitted` tells you the intent committed. It does **not** tell you the *outcome*.
If your process crashed between committing and recording the result, you know the action
happened but not what it produced. Two ways to recover:

* Read the receipt (`fetchReceipt` / `inspect`) to get `createdSlot` and
  `createdUnixTimestamp`, then look up the transaction that created it. That gives you the
  signature and its logs.
* Keep your own record of the outcome alongside the key. The receipt is a guard, not a
  ledger of results — a database row written after a successful send is still the right
  design.

### 8.2 Do not "fix" a conflict by closing the receipt

You cannot: a receipt can only be closed after both deadlines pass, and only by paying the
transaction fee — after which the key is free and the *original* intent loses its
protection too. A conflict is a signal to fix the calling code, not to clean up state.

---

## 9. Code paths that must not bypass the guard

This is the checklist that decides whether the guarantee is real in your application. The
guarantee covers **guarded transactions**; a path that sends the business instructions
without `claim` has no protection whatsoever.

| Path | How it typically bypasses | What to do |
| --- | --- | --- |
| Cron / scheduled jobs | written later, by a different author, with its own send call | route through the same chokepoint builder |
| Backfill or repair scripts | one-off, "just this once" | guard them too, or make them read-only |
| Admin / support tooling | internal, assumed trusted | guard them; support retries are exactly the ambiguous-timeout case |
| Webhook redelivery handlers | at-least-once delivery by design | guard the send, and derive the key from the webhook's own event id |
| Queue consumers | at-least-once delivery; a redelivered message is a retry | same key per message id |
| Multi-region / multi-worker deployments | two workers can both handle the same job | the key is the coordination primitive — make it deterministic from the job, not from the worker |
| Client-side / mobile retry logic | a separate codebase from the server | pass the key from the server; never generate it on the device |
| Third-party relayers and bundlers | they submit what you hand them | hand them a message that already contains the guard |
| CLI tools and scripts | convenient, unguarded | use the same builder module |
| Tests and fixtures | assert the happy path only | add a test that the guard is instruction 0, and a test that a rebuilt retry is blocked |
| Batch / airdrop loops | a loop over recipients, one transaction each | one key per recipient action, not one per loop |
| "Resend" or "retry payment" buttons | a user-facing duplicate-execution button | same key as the original intent — then the button is safe to press twice |
| Any place that signs an already-built message | the guard cannot be inserted after signing | build the guard into the message before signing |

### 9.1 How to enforce it

1. **One chokepoint.** A single function that builds and signs guarded transactions, and
   nothing else sends them. Grep for `sendTransaction`, `sendAndConfirm`,
   `signTransactionMessageWithSigners` and `sendAndConfirmTransactionFactory`; every hit is
   either the chokepoint or a documented exception.
2. **Runtime assertion.** `assertGuarded(message)` before signing (§7.3).
3. **Tests.** At minimum: (a) the guard is the first instruction; (b) two independently built
   attempts for the same intent produce exactly one success and one `AlreadyCommitted`;
   (c) the business action's observable effect happened once.
4. **Observability.** Emit the receipt address, namespace and key on every attempt. Count
   `AlreadyCommitted` and `IdempotencyConflict` separately — the first is healthy, the second
   is an alert.
5. **Code review.** Any new send path is a security-relevant change. Treat "this one doesn't
   need the guard" as a claim to be justified in writing.

---

## 10. Rollback plan

CommitOnce is designed to be removable. Nothing in your program references it, no state in
your program is modified by it, and no account of yours is owned by it. Rolling back is a
client change plus housekeeping on the receipts you already created.

### 10.1 Stop guarding

Remove the `prepareIntent` call and the `guard.instruction` from the instruction list. Deploy.
Your application returns to exactly its previous behaviour.

### 10.2 What remains on chain

| Remains | Consequence |
| --- | --- |
| Every receipt you created | Each holds 1,676,400 lamports (at mainnet rates) until closed. |
| The guard's *effect* on those tuples | A receipt still blocks a `claim` for its `(authority, namespace, key)` until it is closed. Since nothing claims them any more, this is inert. |
| Permanent receipts | **Permanently inert and permanently unrefundable.** There is no close path. This is the one rollback hazard you cannot undo. |

### 10.3 Reclaim the rent

Cleanup is permissionless: anyone can submit `close_receipt`, and the deposit always goes to
the destination recorded at claim time. So a rollback can reclaim everything without the
authority being online — including from a keeper script.

```ts
import { isClosable } from '@commitonce/solana';

const commitOnce = createCommitOnceClient({ rpc });

// Only after BOTH deadlines have passed.
const clock = await commitOnce.fetchClock();

for (const receiptAddress of receiptsToReclaim) {
    const data = await commitOnce.fetchReceipt(receiptAddress);
    if (data === null) continue;                 // already closed
    if (!isClosable(data, clock)) continue;      // not yet: closing would fail with 6009

    const closeInstruction = commitOnce.closeReceiptInstruction({
        receipt: receiptAddress,
        refundDestination: data.refundDestination, // must match the recorded value
    });

    // Build, sign and send a transaction containing closeInstruction, paid by anyone.
}
```

`isClosable` mirrors the program exactly, including the requirement that **both** the slot
deadline and the wall-clock deadline have passed — so a keeper can skip receipts that would
fail with `ReceiptNotExpired` (6009).

### 10.4 If you deployed your own copy of the program

`prepareIntent` accepts `programAddress`, so you can point the SDK at your own deployment.
If you roll that back too, decide what happens to the receipts at that address: they remain
closable as long as the program is deployed. Closing them all first, then abandoning the
program, leaves nothing behind.

### 10.5 What you cannot roll back

* **Permanent receipts.** No close path exists. Choose `permanent` only when you mean it.
* **A receipt closed by someone else.** Once closed, the key is free; that is the documented
  trade-off, not something rollback can restore.
* **A conflict that already happened.** The original fingerprint stays authoritative; the
  application has to decide what the second action should do.

---

## 11. Pre-launch checklist

- [ ] The guard is the first instruction in every transaction that touches guarded state.
- [ ] The authority is a signer of that transaction; the fee payer may be a different key.
- [ ] `assertGuarded(message)` runs before every signature.
- [ ] Namespaces are stable, action-scoped, and contain no per-intent data or version
      suffixes that would silently orphan receipts.
- [ ] The idempotency key is derived from a domain identifier (or generated once and
      persisted), never from an attempt, timestamp, blockhash or signature.
- [ ] The payload contains semantic fields only — no transport details.
- [ ] Amounts are `bigint` or decimal strings; no `Date`, `Map`, `Set`, `undefined` or
      non-finite numbers reach `encodeIntent`.
- [ ] Arrays whose order is not semantic are sorted before hashing.
- [ ] Retention exceeds the worst realistic retry horizon, and the rent you will hold at
      peak volume is acceptable (1,676,400 lamports per live receipt at mainnet rates).
- [ ] Durable-nonce transactions use `retention: 'permanent'`.
- [ ] `AlreadyCommitted` is treated as success; `IdempotencyConflict` alerts and never
      retries.
- [ ] Every send path has been enumerated and either guarded or documented as an exception.
- [ ] A keeper closes expired receipts, or you have consciously decided to leave them.
- [ ] Alerts exist for `IdempotencyConflict` (6001) and for receipt-creation volume.
- [ ] A rollback plan exists, including how the remaining receipts get closed.
