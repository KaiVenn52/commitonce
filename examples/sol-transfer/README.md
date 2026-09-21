# CommitOnce example — guarded SOL transfer

## What this demonstrates

A SOL transfer that can be retried safely, because the guard instruction and the transfer
are in the **same atomic transaction**.

```text
one atomic transaction
├── 0. ComputeBudget   SetComputeUnitPrice   transport only — changes between attempts
├── 1. commit_once     claim                 the guard
└── 2. System Program  Transfer              the business instruction
```

`claim` creates a receipt PDA keyed by `(authority, namespace, idempotency key)`. If that
receipt already exists, `claim` errors, the whole transaction is rolled back, and the
transfer never runs a second time.

The script then does the thing that double-sends without a guard: it submits the same
logical intent a second time as a **genuinely rebuilt transaction** — fresh blockhash,
different priority fee, different signature. Different bytes means a different message
hash, so Solana's own duplicate detection cannot stop it. The receipt can.

The precise guarantee: **at-most-once successful execution of the guarded intent within the
configured retention window.** Not "exactly once" in general — the window is finite by
default, and once a receipt expires and is closed, the key is free again.

## Prerequisites

- Node.js >= 20.18 and pnpm 11 (the versions this repository pins).
- A funded keypair on the cluster you point at. That key is both the fee payer and the
  intent authority.
- The CommitOnce program deployed on that cluster at
  `CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB` (the address compiled into `declare_id!`).
- The SDK built, because `@commitonce/solana` resolves to `dist/`:

  ```bash
  pnpm install
  pnpm --filter @commitonce/solana build
  ```

- A `package.json` in this directory. This is the one setup step: `examples/*` is a workspace
  glob, but a directory without a manifest is not a workspace package, so the example's
  imports would not resolve and `tsx` would load `index.ts` as CommonJS (top-level `await`
  then fails). Create `examples/sol-transfer/package.json`:

  ```json
  {
    "name": "@commitonce/example-sol-transfer",
    "private": true,
    "type": "module",
    "dependencies": {
      "@commitonce/solana": "workspace:*",
      "@solana/kit": "8.3.0",
      "@solana-program/system": "0.14.1"
    }
  }
  ```

  then, from the repository root:

  ```bash
  pnpm install
  ```

## Environment

| Variable | Required | Meaning |
| --- | --- | --- |
| `RPC_URL` | yes | Cluster HTTP endpoint. |
| `KEYPAIR` or `WALLET_PATH` | yes | Path to a Solana CLI keypair JSON file (array of 64 byte values). |
| `RECIPIENT` | yes | Destination address of the transfer. |
| `AMOUNT_LAMPORTS` | yes | Amount in lamports. |
| `ORDER_ID` | no | Idempotency key. Defaults to `order_928`. |
| `MEMO` | no | Extra semantic field, folded into the intent fingerprint. Defaults to `null`. |
| `RPC_WS_URL` | no | WebSocket endpoint for confirmation subscriptions. Defaults to `RPC_URL` with `http` replaced by `ws`. |

Fund the authority with more than `AMOUNT_LAMPORTS` plus fees: the guard's `claim` creates
the receipt account and pays its rent-exempt deposit from the authority (the SDK's mainnet
estimate is `RECEIPT_RENT_LAMPORTS` = 1,676,400 lamports; the exact figure is computed
on-chain from the cluster's rent sysvar). The deposit is refunded in full by
`close_receipt` once the receipt has expired.

## Run

From the repository root:

```bash
export RPC_URL="https://api.devnet.solana.com"
export KEYPAIR="$HOME/.config/solana/id.json"
export RECIPIENT="<destination address>"
export AMOUNT_LAMPORTS="1000000"

pnpm exec tsx examples/sol-transfer/index.ts
```

(`node node_modules/tsx/dist/cli.mjs examples/sol-transfer/index.ts` is equivalent.)

## Expected observable outcome

A timeline, then a result block. Attempt numbers are in the first column, and each retry line
names exactly what changed:

```text
CommitOnce — guarded SOL transfer
  rpc            https://api.devnet.solana.com
  authority      <your address>
  recipient      <destination>
  amount         1000000 lamports
  namespace      examples:sol-transfer
  idempotencyKey order_928
  receipt PDA    <a PDA you can look up on an explorer>
  retention      86400s

[attempt -  ] submit    guarded transfer, up to 3 attempts
[attempt 1  ] send      phase 1 blockhash=5xQ… priorityFee=1000µLamports sig=3nF…
[attempt 1  ] committed signature=3nF…
[attempt -  ] replay    phase 2 — same intent, rebuilt transaction, same idempotency key
[attempt 1  ] send      phase 2 blockhash=9kD… priorityFee=1000µLamports sig=7aB…
[attempt 1  ] blocked   AlreadyCommitted (code 6000) — duplicate blocked, the transfer did not run a second time

Result
  phase 1            committed after 1 attempt(s)
  phase 2            duplicate-blocked after 1 attempt(s)
  recipient before   0 lamports
  recipient after    1000000 lamports
  delta              1000000 lamports (one transfer, not two)
  receipt status     committed
  receipt matches    true (true means the stored fingerprint is this same intent)
```

What to check:

- `phase 2` reports `duplicate-blocked`, not `committed`.
- The recipient's balance moved by exactly one transfer.
- `receipt status` is `committed` and `receipt matches` is `true`.

If the first attempt's response is lost (a timeout), you will instead see a `retry` line:

```text
[attempt 1  ] retry     blockhash expired before confirmation — rebuilding with fresh blockhash, priorityFee 1000 -> 2000µLamports, idempotency key unchanged (order_928)
```

That is the interesting case: attempt 1 may or may not have landed, the client cannot tell,
and the rebuilt attempt 2 is rejected by the receipt if it did. `AlreadyCommitted` is the
answer to "did my transfer already happen?", and it is a success, not a failure.

## Two failures that must not be conflated

The example handles both explicitly and differently:

- **`AlreadyCommitted` (6000)** — the receipt exists with the *same* payload fingerprint.
  The intent already committed and this transaction was aborted. Nothing to do.
- **`IdempotencyConflict` (6001)** — the receipt exists with a *different* fingerprint. This
  is not a duplicate of your intent; the key was reused for something else. The script stops
  and reports it rather than retrying, because retrying unchanged would fail forever and
  retrying with a new key would execute a second, different action.

## Why the idempotency key is semantic

The key is `ORDER_ID`, and the payload fingerprint is:

```ts
{ action: 'sol-transfer', to, lamports, memo, orderId }
```

Nothing about the transport is in it — no blockhash, no priority fee, no compute budget, no
signature, no retry counter, no submission route. All of those change when a transaction is
rebuilt, so including any of them would make attempt 2 look like a *different* intent: the
guard would answer `IdempotencyConflict` instead of `AlreadyCommitted`, and a rebuilt retry
would be treated as a brand new action and send the SOL a second time. That is the whole
product defeated, by one field in a hash.

The same reasoning applies to observed state: do not fold "the recipient's current balance"
or "the account's current nonce" into the fingerprint. Intent is what the user asked for.

## Placeholders and unverified details

- **Compute budget instruction is hand-encoded.** `setComputeUnitPriceInstruction` writes the
  `SetComputeUnitPrice` wire format by hand (program `ComputeBudget111111111111111111111111111111`,
  tag `3`, u64 micro-lamports little-endian) because this repository does not depend on
  `@solana-program/compute-budget` and the example must not import a package that is not
  installed. If you add that package, replace the helper with its
  `getSetComputeUnitPriceInstruction({ microLamports })`. This is the one place in this
  example where an interface outside the repository is encoded rather than imported.
- `SystemProgram.transfer` is the `@solana/web3.js` spelling. This example uses
  `@solana/kit`, whose equivalent is `getTransferSolInstruction` from
  `@solana-program/system` — same instruction, same accounts, same data.

## Status

**This example has not been executed against a live cluster.** It has been run only far
enough to confirm that it loads, resolves its imports, derives the receipt PDA, and reports a
clear error when `RPC_URL` or `KEYPAIR` is missing. No transaction was submitted, and nothing
here has been tested against a deployed CommitOnce program. Treat the expected output above
as the shape of the output, not as captured evidence.

## Security note

**The guard protects only transactions that actually include it.** It is a property of a
transaction, not of an account, a mint, or a program. If the same logical payment can leave
your system through any other path — a different code path, a manual CLI transfer, another
program's CPI that does not prepend `claim` — that path is completely unprotected. Closing
that hole requires that every path which can perform this action builds its transaction
through the guard, with the same `(authority, namespace, idempotency key)` tuple. A second
path with a different namespace or a different key is a second, unprotected path.

Two further boundaries, both deliberate:

- **The window is finite unless you choose `permanent`.** After a receipt expires and is
  cleaned up, the key can be claimed again. `permanent` costs its rent deposit forever.
- **The authority is a single key.** There is no multisig or threshold authority today.
