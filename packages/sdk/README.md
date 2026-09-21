# @commitonce/solana

**Idempotency keys for Solana.** Retry without executing twice.

An onchain idempotency layer for Solana actions. It gives a logical intent — "increment my
counter by one", "pay this invoice", "open this position" — an onchain receipt, so a retry
that was rebuilt with a fresh blockhash and a new priority fee cannot execute the business
instruction a second time.

```bash
npm install @commitonce/solana @solana/kit
```

```ts
import { createCommitOnceClient } from '@commitonce/solana';

const client = createCommitOnceClient({ rpc });
const prepared = await client.prepare({
    authority,
    namespace: 'payments:transfer',
    idempotencyKey: orderId,
    retention: '7d',
    payload: { recipient, amount },
});

// Prepend the guard to the SAME atomic transaction as the business instruction.
const message = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(authority, tx),
    (tx) => appendTransactionMessageInstructions([prepared.instruction, transferIx], tx),
    // ...
);
```

## The guarantee, stated precisely

> **At-most-once successful execution of a guarded logical intent within the configured
> retention window.**

Equivalently, the invariant the program enforces:

> For one authority + namespace + idempotency key, no more than one guarded transaction may
> successfully commit during the receipt retention period.

This is **not** universal "exactly once", and the difference matters. A receipt can be closed
after it expires, which frees the key for a new claim. Use `retention: 'permanent'` when a key
must never be reusable.

## Why this is needed

Solana deduplicates transactions by **message hash**, not by signature. A *rebuilt* retry — one
with a fresh blockhash, a raised priority fee, or a different route — produces a different
message, a different message hash, and therefore a different transaction as far as the runtime
is concerned. Both attempts can land. The official production-readiness guidance says as much:

> "A rebuilt transaction has a new signature, so preserve application-level idempotency before
> sending it."
> — <https://solana.com/docs/tools/production-readiness>

## What it costs

Measured, not estimated. The wire bytes and account counts are exact; compute units vary run to
run, so they are given as a range (see `EVIDENCE.md` §6).

| | Compute units (observed range) | Wire bytes | Accounts |
| --- | --- | --- | --- |
| Business instruction alone | 4,067 – 10,067 | 273 | 3 |
| With the guard | 12,404 – 22,904 | 677 | 7 |
| **Guard delta** | **+8,337 – +12,837** | **+404** | **+4** |

On devnet the `claim` instruction itself consumed **14,669 CU** when it succeeded and
**13,977 CU** when it rejected a duplicate. Budget ~23,000 CU for a guarded transaction.

The receipt account is 202 bytes and costs **0.0016764 SOL** in rent, which is **fully
refundable** — `closeReceiptInstruction()` returns all of it once the retention window has
elapsed.

## API

| Export | Purpose |
| --- | --- |
| `createCommitOnceClient` | RPC-backed client: `prepare`, `deriveReceipt`, `fetchReceipt`, `inspect`, `fetchClock`, `closeReceiptInstruction` |
| `prepareIntent` | Build a `claim` instruction without an RPC connection |
| `encodeClaimData` | Encode the `claim` instruction data by hand |
| `deriveReceiptAddress` | Derive the receipt PDA from authority, namespace and key |
| `decodeIntentReceipt` | Decode a receipt account |
| `decodeEventsFromLogs` | Decode the program's events out of a transaction's logs |
| `classifyError` | Turn an RPC or program error into a decision: retry, stop, or conflict |
| `isAlreadyCommitted` | `true` when the retry was correctly blocked |
| `namespaceHash`, `idempotencyKeyHash`, `hashIntent` | The domain-separated hashes, if you want to compute them yourself |

Every hash is computed with WebCrypto (`globalThis.crypto.subtle`), so this package has **zero
runtime dependencies**. `@solana/kit` is a peer dependency.

### Reading events

An event is not an account, so it lives only in the transaction's logs, as
`Program data: <base64>`. One call gets them all:

```ts
import { decodeEventsFromLogs } from '@commitonce/solana';

const events = decodeEventsFromLogs(meta.logMessages ?? []);
const committed = events.find((e) => e.name === 'IntentCommitted');
if (committed?.name === 'IntentCommitted') {
    committed.data.createdSlot;      // bigint
    committed.data.payloadHash;      // Uint8Array
}
```

Other programs' events — including the demo counter's — are skipped rather than throwing,
because a `Program data:` line does not say who emitted it. A malformed *CommitOnce* event does
throw, because that is a real version mismatch.

The decoders are pinned against a real event emitted by the deployed program on devnet, so the
layout is checked against the chain and not against a document.

## Runtime support

Node.js >= 20.18.0 (required by `@solana/kit`), modern browsers, Deno and Bun. In a browser,
WebCrypto requires a secure context — `https`, or `localhost`.

Ships dual ESM and CommonJS builds with type declarations for both.

## Correct usage

The guard must be in the **same transaction** as the business instruction. That is what makes
the guarantee atomic: if the receipt already exists, `claim` fails and the whole transaction
reverts, so the business instruction never runs.

```ts
// Correct: one transaction, guard first.
[prepared.instruction, transferIx];

// Wrong: two transactions. The guard would commit, then the business instruction could
// still fail on its own, and you would have consumed the key without doing the work.
[prepared.instruction], [transferIx];
```

## Documentation

- [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) — how it works, and why
- [`docs/API_REFERENCE.md`](../../docs/API_REFERENCE.md) — every export, in full
- [`docs/INTEGRATION_PLAYBOOK.md`](../../docs/INTEGRATION_PLAYBOOK.md) — adopting it in an existing app
- [`docs/CONCEPTS.md`](../../docs/CONCEPTS.md) — namespaces, keys, retention, payload fingerprints
- [`SECURITY.md`](../../SECURITY.md) — the security model and its limits

## Status

**Unaudited.** Deployed to devnet only:

- `commit_once` — `CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB`
- `demo_counter` — `EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5`

Not deployed to mainnet-beta. Do not treat this as production-ready. See
[`NEEDS_OWNER_ACTION.md`](../../NEEDS_OWNER_ACTION.md).

## License

Apache-2.0.
