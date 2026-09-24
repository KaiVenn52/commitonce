# CommitOnce example — guarding an already-built swap transaction

## Read this first

This example has been **run against a real Jupiter swap transaction**, fetched from Jupiter's
live aggregator API. Raw output:
[`submission/evidence/jupiter-swap-dry-run.log`](../../submission/evidence/jupiter-swap-dry-run.log).

What it deliberately does **not** do is encode a Jupiter endpoint, request body, quote format or
instruction layout — those are Jupiter's to define, this repository does not own them, and
guessing would produce code that looks authoritative and is wrong. `scripts/fetch-jupiter-swap.mjs`
calls the real API instead, and a fetched transaction is committed at
[`fixtures/jupiter-swap-mainnet.base64`](fixtures/jupiter-swap-mainnet.base64) so the run is
reproducible without calling Jupiter at all.

What the example does show, correctly and completely, is the part that is CommitOnce's business:
**given a serialized transaction that somebody else built, how do you prepend the guard and
submit it?** The transaction is supplied by the environment:

- `JUPITER_SWAP_TX` — the base64-encoded serialized transaction, or
- `JUPITER_SWAP_TX_FILE` — a path to a file containing that base64 string (base64 text, not
  raw bytes).

## `--dry-run`: verify the composition with no funds and no deployment

```bash
RPC_URL=https://api.mainnet-beta.solana.com \
KEYPAIR=~/.config/solana/id.json \
JUPITER_SWAP_TX_FILE=examples/jupiter-swap/fixtures/jupiter-swap-mainnet.base64 \
INPUT_MINT=So11111111111111111111111111111111111111112 \
OUTPUT_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
AMOUNT_BASE_UNITS=1000000 \
DRY_RUN=1 \
node examples/jupiter-swap/index.ts
```

It composes and signs exactly what the submit path would, prints it, and stops. **Nothing is
submitted, so the keypair needs no funds.** A mainnet RPC endpoint is required, because the
transaction's address lookup tables have to be resolved on the cluster they live on.

This exists because the full path needs two things that cannot currently coexist: Jupiter's
aggregator is mainnet-only, and CommitOnce is devnet-only, so the two never meet. Without a dry
run the composition could not be exercised by anyone — including its author — without
hand-waving.

What the dry run **verifies**: the guard prepends cleanly to a real third-party transaction, the
supplied instructions keep their order and contents, and no duplicate ComputeBudget instruction
is introduced.

What it does **not** verify: execution. That needs `commit_once` deployed on the cluster the swap
targets, plus a funded keypair there.

## What this demonstrates

```text
the transaction you are given          after prepending
├── 0. compute budget  SetComputeUnitLimit      ├── 0. commit_once     claim                (the guard)
├── 1. compute budget  SetComputeUnitPrice      ├── 1. compute budget  SetComputeUnitLimit  (unchanged)
└── 2. swap instructions (n of them)            ├── 2. compute budget  SetComputeUnitPrice  (unchanged)
                                                └── 3. swap instructions (n of them, same order)
```

The swap's own instructions are not modified, reordered, or reinterpreted. They are simply no
longer first. One atomic transaction, so if the receipt already exists, `claim` errors and the
swap does not execute.

**Note what is absent: this example adds no priority-fee instruction of its own.** An earlier
revision did, and it did not work. A swap API's transaction already carries
`SetComputeUnitLimit` and `SetComputeUnitPrice`, and the runtime rejects a transaction with two
ComputeBudget instructions of the same kind:

```
invalid transaction: Transaction contains a duplicate instruction (3) that is not allowed
```

That is what a real Jupiter swap exposed the first time this example was pointed at one. The
guard is now the *only* instruction this example adds, and it adds a price instruction only when
the supplied transaction does not already set one. Raising the fee for a swap belongs in the swap
API's own priority-fee parameter.

The script also makes the central trap visible. A swap API returns a *different* transaction on
every quote — different blockhash, different route, different intermediate accounts, different
compute budget — while the user's intent ("swap 100 USDC for at least this much SOL, order
928") is unchanged. Two quotes taken minutes apart for the identical request produced a 922-byte
transaction routed `Meteora DLMM → AlphaQ` and a 570-byte transaction routed `Flux`. The example
prints a SHA-256 digest of the supplied transaction bytes and labels it "diagnostic only, NOT
part of the intent fingerprint", because fingerprinting those bytes would make every re-quote
look like a brand new intent: the guard would report `IdempotencyConflict` instead of
`AlreadyCommitted`, and a rebuilt retry would be treated as a second swap.

The precise guarantee: **at-most-once successful execution of the guarded intent within the
configured retention window.** Not "exactly once" in general — after a receipt expires and is
closed, the key is free again.

## Prerequisites

- Node.js >= 20.18 and pnpm 11 (the versions this repository pins).
- A funded keypair on the cluster you point at. The guard requires its authority to sign, and
  this example assumes that same key is the transaction's fee payer.
- The CommitOnce program deployed on that cluster at
  `CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB` (the address compiled into `declare_id!`).
- A base64 serialized transaction to guard, from the swap client you use.
- The SDK built, because `@commitonce/solana` resolves to `dist/`:

  ```bash
  pnpm install
  pnpm --filter @commitonce/solana build
  ```

- A `package.json` in this directory. This is the one setup step: `examples/*` is a workspace
  glob, but a directory without a manifest is not a workspace package, so the example's
  imports would not resolve and `tsx` would load `index.ts` as CommonJS (top-level `await`
  then fails). Create `examples/jupiter-swap/package.json`:

  ```json
  {
    "name": "@commitonce/example-jupiter-swap",
    "private": true,
    "type": "module",
    "dependencies": {
      "@commitonce/solana": "workspace:*",
      "@solana/kit": "8.3.0"
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
| `RPC_URL` | yes | Cluster HTTP endpoint. Also used to resolve the transaction's address lookup tables. |
| `KEYPAIR` or `WALLET_PATH` | yes | Path to a Solana CLI keypair JSON file (array of 64 byte values). Must be the transaction's fee payer. |
| `JUPITER_SWAP_TX` | one of these two | Base64-encoded serialized transaction. |
| `JUPITER_SWAP_TX_FILE` | one of these two | Path to a file containing that base64 string. |
| `INPUT_MINT` | yes | The mint you are selling. Semantic, from your request — not read from the transaction. |
| `OUTPUT_MINT` | yes | The mint you are buying. Semantic, from your request. |
| `AMOUNT_BASE_UNITS` | yes | Input amount in base units. Semantic, from your request. |
| `SLIPPAGE_BPS` | no | Slippage tolerance in basis points. Semantic, from your request. Defaults to `null`. |
| `ORDER_ID` | no | Idempotency key. Defaults to `order_928`. |
| `MEMO` | no | Extra semantic field, folded into the intent fingerprint. Defaults to `null`. |
| `RPC_WS_URL` | no | WebSocket endpoint for confirmation subscriptions. Defaults to `RPC_URL` with `http` replaced by `ws`. |

Fund the authority with SOL for fees and for the receipt's rent-exempt deposit (the SDK's
mainnet estimate is `RECEIPT_RENT_LAMPORTS` = 1,676,400 lamports; the exact figure is computed
on-chain from the cluster's rent sysvar). The deposit is refunded by `close_receipt` after the
retention window.

## Run

From the repository root:

```bash
export RPC_URL="https://api.mainnet-beta.solana.com"
export KEYPAIR="$HOME/.config/solana/id.json"
export INPUT_MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
export OUTPUT_MINT="So11111111111111111111111111111111111111112"
export AMOUNT_BASE_UNITS="100000000"
export SLIPPAGE_BPS="50"
export JUPITER_SWAP_TX_FILE="/tmp/swap-tx.base64"   # or JUPITER_SWAP_TX="<base64>"

pnpm exec tsx examples/jupiter-swap/index.ts
```

(`node node_modules/tsx/dist/cli.mjs examples/jupiter-swap/index.ts` is equivalent.)

## Expected observable outcome

The header and the instruction list are printed before anything is submitted, so the
structural claim — guard first, swap instructions intact — is visible without a cluster that
has the program deployed:

```text
CommitOnce — guarded third-party swap transaction (structural example)
  rpc              https://api.mainnet-beta.solana.com
  authority        <your address>
  namespace        examples:jupiter-swap
  idempotencyKey   order_928
  receipt PDA      <a PDA you can look up on an explorer>
  retention        86400s

  supplied tx      2312 base64 chars, 4 instruction(s)
  tx digest        <sha256 of the supplied bytes>
                   (diagnostic only — NOT part of the intent fingerprint)
  fee payer        <your address>

Instructions in the supplied transaction:
    [0] program=ComputeBudget111111111111111111111111111111 accounts=0 data=5B
    [1] program=ComputeBudget111111111111111111111111111111 accounts=0 data=9B
    [2] program=<the swap program> accounts=13 data=8B
    [3] program=<another program in the route> accounts=9 data=…

[attempt -  ] submit    guarded swap, up to 3 attempts
[attempt 1  ] send      phase 1 blockhash=5xQ… priorityFee=1000µLamports sig=3nF… instructions=6 (4 swap + guard + compute budget)
[attempt 1  ] committed signature=3nF…

Instructions actually submitted (guard first, swap unchanged):
    [0] program=ComputeBudget111111111111111111111111111111 accounts=0 data=9B
    [1] program=CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB accounts=4 data=144B
    [2] program=ComputeBudget111111111111111111111111111111 accounts=0 data=5B
    [3] program=ComputeBudget111111111111111111111111111111 accounts=0 data=9B
    [4] program=<swap instruction, unchanged>
    [5] program=<swap instruction, unchanged>

[attempt -  ] replay    phase 2 — same intent, rebuilt transaction, same idempotency key
[attempt 1  ] send      phase 2 blockhash=9kD… priorityFee=1000µLamports sig=7aB… instructions=6 (4 swap + guard + compute budget)
[attempt 1  ] blocked   AlreadyCommitted (code 6000) — duplicate blocked, the swap did not execute a second time

Result
  phase 1          committed after 1 attempt(s)
  phase 2          duplicate-blocked after 1 attempt(s)
  receipt status   committed
  receipt matches  true (true means the stored fingerprint is this same intent)
```

What to check:

- Instruction `[1]` of the submitted transaction is the guard: program
  `CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB`, four accounts, 144 bytes of data. The swap
  instructions follow, in their original relative order.
- The instruction list from the supplied transaction is identical to instructions `[2]` onward
  of the submitted transaction.
- `phase 2` reports `duplicate-blocked`, not `committed`.

On an ambiguous first attempt you will see a `retry` line instead, naming what changed:

```text
[attempt 1  ] retry     blockhash expired before confirmation — rebuilding with fresh blockhash, priorityFee 1000 -> 2000µLamports, idempotency key unchanged (order_928)
```

## Limitations you must understand before adapting this

These are properties of prepending an instruction to somebody else's transaction, not bugs in
the example.

- **Every existing signature is invalidated.** Prepending changes the message, so the
  transaction the swap API returned cannot be sent as-is any more: your wallet has to sign
  again, and so does every other required signer. This is unavoidable — a message hash covers
  the whole message.
- **The prepended priority fee is usually overridden.** In a Solana transaction the *last*
  `SetComputeUnitPrice` instruction wins. Ours is prepended, so if the supplied transaction
  contains its own price instruction (swap transactions usually do), that one takes effect.
  Raising the fee for a swap belongs in the swap API's own priority-fee parameter, not here.
- **Lookup tables are resolved, and not preserved.** A compiled v0 message refers to accounts
  by address-lookup-table index, so the example resolves them against the cluster before it
  can edit the message. The decompiled message holds those accounts as ordinary static
  accounts, so recompiling it will not re-use the tables — and a swap transaction that used
  lookup tables to fit under the 1232-byte packet limit can grow past it. If your transaction
  is large, re-quote it so that the aggregator returns a transaction that already accounts for
  the guard's extra instruction, or add the guard before the transaction is built.
- **Durable-nonce transactions are refused.** A nonce transaction never expires, so a finite
  receipt window would be meaningless for it; the program rejects that combination with
  `DurableNonceUnsupported` (6002) unless retention is `permanent`. The example detects the
  nonce lifetime and stops with an explanation rather than letting the program reject it.
- **The fee payer must be the signing authority.** The guard requires its authority to sign,
  and this example attaches that same signer as the fee payer. A relayer that pays the fee
  instead makes it a two-signer transaction, which this example does not implement.
- **Re-using the supplied transaction on retry is not a real re-quote.** The retry refreshes
  the blockhash and re-prepends the guard, but the swap's instructions are the ones the API
  returned earlier. In production each attempt must re-quote, because pool state and route
  move. The code says so where it matters.

## Placeholders and unverified details

- **The Jupiter integration has been run against the live API, but not executed end to end.**
  A real transaction was fetched from Jupiter's public aggregator API and committed as a fixture;
  the composition was verified against it in dry-run mode. What remains unverified is execution,
  which needs `commit_once` on mainnet and a funded keypair there. No Jupiter host, path, request
  body, response shape or instruction layout appears anywhere in this example, because the
  repository does not know Jupiter's current API. `loadSwapTransactionBase64()` is a
  deliberate placeholder: it reads the transaction from `JUPITER_SWAP_TX` or
  `JUPITER_SWAP_TX_FILE` and, if neither is set, throws an error explaining what to supply.
  A real integration replaces that one function with a call to the swap API — and calls it
  once per attempt, so that each attempt gets a fresh quote, blockhash and priority fee.
- **Compute budget instruction is hand-encoded.** `setComputeUnitPriceInstruction` writes the
  `SetComputeUnitPrice` wire format by hand (program `ComputeBudget111111111111111111111111111111`,
  tag `3`, u64 micro-lamports little-endian) because this repository does not depend on
  `@solana-program/compute-budget` and the example must not import a package that is not
  installed. If you add that package, replace the helper with its
  `getSetComputeUnitPriceInstruction({ microLamports })`.
- **The instruction list printed for the supplied transaction is decoded, not interpreted.**
  It reports program address, account count and data length. It does not claim to know what
  those instructions do.

## Status

**This example has not been executed against a live cluster, and the Jupiter integration has
never been run against Jupiter's live API.** It has been run only far enough to confirm that
it loads, resolves its imports, decodes a base64 transaction and decompiles its message, prints
the instruction list, derives the receipt PDA, and reports a clear error when `RPC_URL`,
`KEYPAIR`, or the swap transaction is missing. The transaction used for that check was built
locally with `@solana/kit`, contained no address lookup tables and no swap, and no transaction
was submitted. Treat the expected output above as the shape of the output, not as captured
evidence, and treat the swap path as unproven against any real aggregator.

It **does** typecheck: this example is part of the workspace, so `pnpm -r typecheck` compiles
it against the real SDK. A change to the SDK that breaks this file fails the build.

## Security note

**The guard protects only transactions that actually include it.** It is a property of a
transaction, not of an account, a mint, or a program. If the same logical swap can be executed
through any other path — a different code path in your app, a retry that does not re-prepend
the guard, a route that submits the aggregator's transaction unchanged, a manual CLI call —
that path is completely unprotected. Closing that hole requires that every path which can
perform this action builds its transaction through the guard, with the same
`(authority, namespace, idempotency key)` tuple. A second path with a different namespace or a
different key is a second, unprotected path.

Two further boundaries, both deliberate:

- **The window is finite unless you choose `permanent`.** After a receipt expires and is
  cleaned up, the key can be claimed again. `permanent` costs its rent deposit forever.
- **The authority is a single key.** There is no multisig or threshold authority today.

## Transaction size, which is the real constraint

The guard is not small. Prepending it to the real Jupiter transaction in [`fixtures/`](fixtures/) takes the composed transaction to **~1,140 bytes of the 1,232-byte limit — 93%, with 92 bytes left.** That is the number Jupiter's own documentation warns about: *"When building custom transactions with `/build`, you may hit the 1232-byte transaction size limit, especially when adding custom instructions alongside the swap."* Prepending a guard is exactly that. The dry run measures and prints it, because the size decides whether an integration works and nothing else in this repository reported it.

Both mitigations are Jupiter's, and they are named here because a caller who hits the limit will not know where to look:

* **`maxAccounts`** (1-64, default 64) limits the route's account count. Lower values produce simpler routes and leave room for custom instructions, at the cost of routing quality — Jupiter warns that very low values can produce *no route at all*.
* **Drop the no-op setup instructions.** The `setupInstructions` from `/build` always include `createAssociatedTokenAccountIdempotent`, even for accounts that already exist. They are no-ops, but they consume space, and they can be filtered out after an `getAccountInfo` check.

Run `DRY_RUN=1 node examples/jupiter-swap/index.ts` to see the figure for the committed
fixture. It will differ for a live quote, and a longer route will not fit.
