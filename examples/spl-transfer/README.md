# CommitOnce example — guarded SPL `TransferChecked` with destination ATA creation

## What this demonstrates

A token transfer that can be retried safely, and the instruction ordering that makes the
failure mode unambiguous.

```text
one atomic transaction
├── 0. ComputeBudget     SetComputeUnitPrice      transport only — changes between attempts
├── 1. commit_once       claim                    the guard — FIRST
├── 2. ATA program       CreateIdempotent         destination ATA, created only if absent
└── 3. SPL Token         TransferChecked          the business instruction
```

`claim` creates a receipt PDA keyed by `(authority, namespace, idempotency key)`. If it
already exists, `claim` errors, the whole transaction is rolled back, and neither the ATA
creation nor the transfer runs.

As in the SOL example, the script then submits the same logical intent a second time as a
genuinely rebuilt transaction (fresh blockhash, different priority fee, different signature)
and shows that the guard blocks it.

The precise guarantee: **at-most-once successful execution of the guarded intent within the
configured retention window.** Not "exactly once" in general — after a receipt expires and
is closed, the key is free again.

## Why the guard goes first, and why the ATA instruction is the idempotent variant

**Guard first.** Any instruction that can fail before the guard can mask the guard's answer.
If the ATA creation ran first, a duplicate attempt might fail with "account already in use"
(or, with the idempotent variant, quietly succeed) and the caller would never learn that the
transfer had already happened. With the guard first, a duplicate produces `AlreadyCommitted`
— a specific answer to "did this already happen?" — before anything else can fail. The same
applies to compute budget, delegate, and account-validation errors.

**Idempotent ATA creation.** The destination's token account may legitimately already exist,
created by an earlier unrelated transaction. The non-idempotent variant would fail in that
case for no good reason, so this example uses
`getCreateAssociatedTokenIdempotentInstructionAsync`.

Note what the guard does *not* do: it does not make the ATA instruction idempotent, and the
ATA instruction does not make the transfer idempotent. They solve different problems. The
guard answers "has this logical intent already committed?"; the idempotent ATA instruction
answers "does this account exist yet?".

## Prerequisites

- Node.js >= 20.18 and pnpm 11 (the versions this repository pins).
- A funded keypair on the cluster you point at. It is the fee payer, the intent authority,
  and the payer of the destination ATA's rent.
- A token account for that key holding the mint, with at least `AMOUNT_BASE_UNITS` available.
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
  then fails). Create `examples/spl-transfer/package.json`:

  ```json
  {
    "name": "@commitonce/example-spl-transfer",
    "private": true,
    "type": "module",
    "dependencies": {
      "@commitonce/solana": "workspace:*",
      "@solana/kit": "8.3.0",
      "@solana-program/token": "0.16.1"
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
| `MINT` | yes | The token mint. Its decimals are read from the chain, not from an environment variable. |
| `RECIPIENT` | yes | Owner of the destination token account. |
| `AMOUNT_BASE_UNITS` | yes | Amount in base units, i.e. whole tokens × 10^decimals. |
| `ORDER_ID` | no | Idempotency key. Defaults to `order_928`. |
| `MEMO` | no | Extra semantic field, folded into the intent fingerprint. Defaults to `null`. |
| `RPC_WS_URL` | no | WebSocket endpoint for confirmation subscriptions. Defaults to `RPC_URL` with `http` replaced by `ws`. |

Fund the authority with SOL as well as tokens: the guard's `claim` pays the receipt's
rent-exempt deposit (the SDK's mainnet estimate is `RECEIPT_RENT_LAMPORTS` = 1,676,400
lamports; the exact figure is computed on-chain from the cluster's rent sysvar) and the ATA
creation pays the destination account's rent. The receipt deposit is refunded by
`close_receipt` after the retention window; the ATA rent belongs to the ATA.

## Run

From the repository root:

```bash
export RPC_URL="https://api.devnet.solana.com"
export KEYPAIR="$HOME/.config/solana/id.json"
export MINT="<token mint>"
export RECIPIENT="<destination owner>"
export AMOUNT_BASE_UNITS="1000000"   # 1.0 token at 6 decimals

pnpm exec tsx examples/spl-transfer/index.ts
```

(`node node_modules/tsx/dist/cli.mjs examples/spl-transfer/index.ts` is equivalent.)

## Expected observable outcome

```text
CommitOnce — guarded SPL TransferChecked
  rpc              https://api.devnet.solana.com
  authority        <your address>
  mint             <mint> (decimals 6)
  recipient        <destination owner>
  amount           1000000 base units
  source ATA       <your token account>
  destination ATA  <the recipient's token account>
  namespace        examples:spl-transfer
  idempotencyKey   order_928
  receipt PDA      <a PDA you can look up on an explorer>
  retention        86400s

Instruction order in the guarded transaction:
  0. compute budget  SetComputeUnitPrice   (transport only)
  1. commit_once     claim                 (the guard)
  2. ATA program     CreateIdempotent      (destination ATA, if absent)
  3. SPL Token       TransferChecked       (the business instruction)

[attempt -  ] submit    guarded transfer, up to 3 attempts
[attempt 1  ] send      phase 1 blockhash=5xQ… priorityFee=1000µLamports sig=3nF…
[attempt 1  ] committed signature=3nF…
[attempt -  ] replay    phase 2 — same intent, rebuilt transaction, same idempotency key
[attempt 1  ] send      phase 2 blockhash=9kD… priorityFee=1000µLamports sig=7aB…
[attempt 1  ] blocked   AlreadyCommitted (code 6000) — duplicate blocked, no ATA rent paid and no tokens moved

Result
  phase 1               committed after 1 attempt(s)
  phase 2               duplicate-blocked after 1 attempt(s)
  source before/after   5000000 -> 4000000
  destination before    0
  destination after     1000000
  delta                 1000000 base units (one transfer, not two)
  receipt status        committed
  receipt matches       true (true means the stored fingerprint is this same intent)
```

What to check:

- `phase 2` reports `duplicate-blocked`, not `committed`.
- The destination's token balance moved by exactly one transfer, and the source's balance
  fell by exactly that amount.
- If the destination token account did not exist before the run, it exists afterwards — and
  a replayed attempt does not create a second one, because the transaction never runs.

On an ambiguous first attempt you will see a `retry` line instead, naming what changed:

```text
[attempt 1  ] retry     blockhash expired before confirmation — rebuilding with fresh blockhash, priorityFee 1000 -> 2000µLamports, idempotency key unchanged (order_928)
```

## Two failures that must not be conflated

- **`AlreadyCommitted` (6000)** — the receipt exists with the *same* payload fingerprint.
  The intent already committed; this transaction was aborted. Nothing to do.
- **`IdempotencyConflict` (6001)** — the receipt exists with a *different* fingerprint. The
  key was reused for something else. The script stops and reports it rather than retrying:
  retrying unchanged would fail forever, and retrying with a new key would move tokens a
  second time for a different intent.

A mistyped `AMOUNT_BASE_UNITS` on a retry is exactly how you produce an
`IdempotencyConflict`: the amount is part of the fingerprint, so "order_928 for 1 token" and
"order_928 for 10 tokens" are distinguishable, and the second one fails loudly instead of
silently reusing the first one's result.

## Why the idempotency key is semantic

The key is `ORDER_ID`, and the payload fingerprint is:

```ts
{ action: 'spl-transfer-checked', mint, to, amountBaseUnits, decimals, memo, orderId }
```

Nothing about the transport is in it — no blockhash, no priority fee, no compute budget, no
signature, no retry counter, no submission route. Every one of those changes when a
transaction is rebuilt, so including any of them would make attempt 2 look like a *different*
intent: the guard would answer `IdempotencyConflict` instead of `AlreadyCommitted`, and a
rebuilt retry would be treated as a brand new action and move the tokens again. That is the
whole product defeated, by one field in a hash.

Observed state belongs in the same exclusion list. Do not fingerprint the source ATA's
balance or whether the destination ATA exists: those change for reasons unrelated to the
intent, and folding them in would turn an honest retry into a reported conflict.

`decimals` is in the fingerprint because it is part of what was asked for (an amount in base
units is meaningless without the scale), and it is read from the mint rather than from an
environment variable so a mistyped scale cannot silently change the intent.

## Placeholders and unverified details

- **Compute budget instruction is hand-encoded.** `setComputeUnitPriceInstruction` writes the
  `SetComputeUnitPrice` wire format by hand (program `ComputeBudget111111111111111111111111111111`,
  tag `3`, u64 micro-lamports little-endian) because this repository does not depend on
  `@solana-program/compute-budget` and the example must not import a package that is not
  installed. If you add that package, replace the helper with its
  `getSetComputeUnitPriceInstruction({ microLamports })`. This is the one place in this
  example where an interface outside the repository is encoded rather than imported.
- Only the classic SPL Token program is used (`TOKEN_PROGRAM_ADDRESS`, i.e.
  `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`). Token-2022 mints are not handled here;
  they need the Token-2022 program id and, for some extensions, extra accounts.

## Status

**This example has not been executed against a live cluster.** It has been run only far
enough to confirm that it loads, resolves its imports, derives the receipt PDA, derives both
associated token addresses, builds the four-instruction message and signs it, and reports a
clear error when `RPC_URL` or `KEYPAIR` is missing. No transaction was submitted, and nothing
here has been tested against a deployed CommitOnce program. Treat the expected output above
as the shape of the output, not as captured evidence.

It **does** typecheck: this example is part of the workspace, so `pnpm -r typecheck` compiles
it against the real SDK. A change to the SDK that breaks this file fails the build.

## Security note

**The guard protects only transactions that actually include it.** It is a property of a
transaction, not of an account, a mint, or a program. If tokens can leave an account through
any other path — a different code path in your app, a manual CLI transfer, a delegate
transfer, another program's CPI that does not prepend `claim` — that path is completely
unprotected. Closing that hole requires that every path which can perform this action builds
its transaction through the guard, with the same `(authority, namespace, idempotency key)`
tuple. A second path with a different namespace or a different key is a second, unprotected
path.

Two further boundaries, both deliberate:

- **The window is finite unless you choose `permanent`.** After a receipt expires and is
  cleaned up, the key can be claimed again. `permanent` costs its rent deposit forever.
- **The authority is a single key.** There is no multisig or threshold authority today.
