# CommitOnce example — guarding an arbitrary custom program instruction

## What this demonstrates

How to guard a program that knows nothing about CommitOnce.

The business action is this repository's own `demo-counter` program
(`programs/demo-counter/src/lib.rs`, program id
`EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5`). It is a deliberately trivial counter: a
successful `increment` raises `count` by exactly one, which makes "did this run twice?"
directly observable rather than something you have to infer from logs.

```text
one atomic transaction
├── 0. ComputeBudget      SetComputeUnitPrice   transport only — changes between attempts
├── 1. commit_once        claim                 the guard — FIRST
├── 2. demo_counter       initialize            only when the counter does not exist yet
└── 3. demo_counter       increment             the business instruction
```

`claim` creates a receipt PDA keyed by `(authority, namespace, idempotency key)`. If it
already exists, `claim` errors, the whole transaction is rolled back, and the counter is not
incremented again.

`demo-counter` does not import CommitOnce, check for it, or receive any argument about it.
That is the point: the guard is a separate instruction in the same atomic transaction, so any
program can be guarded without being modified.

The precise guarantee: **at-most-once successful execution of the guarded intent within the
configured retention window.** Not "exactly once" in general — after a receipt expires and is
closed, the key is free again.

## Swapping in your own program

1. **Keep the guard first, in the same transaction as your instruction(s).** Not a separate
   transaction: a receipt that committed on its own would block the action it was meant to
   protect. First also matters for the error you see — any instruction that can fail before
   the guard can mask the guard's answer, so a duplicate would surface as some incidental
   error instead of `AlreadyCommitted`.
2. **Fingerprint the semantic arguments of your instruction**: the accounts and values that
   define what the user asked for. Never the blockhash, priority fee, compute budget,
   signature, retry counter or submission route — and never observed state such as the
   current value of an account. See the comment on `intent` in `index.ts` for why.
3. **Build your instruction however you normally do.** If your program has a generated client
   (Codama from `target/idl/<program>.json`, or Anchor's IDL client), use it and delete the
   hand-written builders here. The hand-encoding below exists only because this repository has
   no generated JavaScript client for `demo-counter` checked in — the IDL is at
   `target/idl/demo_counter.json` and the Rust source is the authority.

## Prerequisites

- Node.js >= 20.18 and pnpm 11 (the versions this repository pins).
- A funded keypair on the cluster you point at. It is the fee payer, the intent authority, and
  the payer of the counter account's rent when the counter has to be created.
- The `demo-counter` program deployed on that cluster at
  `EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5` (the address compiled into `declare_id!`).
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
  then fails). Create `examples/custom-program/package.json`:

  ```json
  {
    "name": "@commitonce/example-custom-program",
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
| `RPC_URL` | yes | Cluster HTTP endpoint. |
| `KEYPAIR` or `WALLET_PATH` | yes | Path to a Solana CLI keypair JSON file (array of 64 byte values). |
| `ORDER_ID` | no | Idempotency key. Defaults to `order_928`. |
| `MEMO` | no | Extra semantic field, folded into the intent fingerprint. Defaults to `null`. |
| `RPC_WS_URL` | no | WebSocket endpoint for confirmation subscriptions. Defaults to `RPC_URL` with `http` replaced by `ws`. |

Fund the authority with SOL for fees and for the receipt's rent-exempt deposit (the SDK's
mainnet estimate is `RECEIPT_RENT_LAMPORTS` = 1,676,400 lamports; the exact figure is computed
on-chain from the cluster's rent sysvar). If the counter does not exist yet, the same key also
pays the counter account's rent. The receipt deposit is refunded by `close_receipt` after the
retention window.

## Run

From the repository root:

```bash
export RPC_URL="https://api.devnet.solana.com"
export KEYPAIR="$HOME/.config/solana/id.json"

pnpm exec tsx examples/custom-program/index.ts
```

(`node node_modules/tsx/dist/cli.mjs examples/custom-program/index.ts` is equivalent.)

## Expected observable outcome

```text
CommitOnce — guarded custom program instruction (demo-counter)
  rpc              https://api.devnet.solana.com
  authority        <your address>
  business program EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5
  counter PDA      <seeds [b"counter", authority] under the demo-counter program>
  count before     account does not exist yet
  namespace        examples:demo-counter
  idempotencyKey   order_928
  receipt PDA      <a PDA you can look up on an explorer>
  retention        86400s

Instruction order in the guarded transaction:
  0. compute budget  SetComputeUnitPrice  (transport only)
  1. commit_once     claim                (the guard)
  2. demo_counter    initialize           (counter absent)
  3. demo_counter    increment            (the business instruction)

[attempt -  ] submit    guarded increment, up to 3 attempts
[attempt 1  ] send      phase 1 blockhash=5xQ… priorityFee=1000µLamports sig=3nF… businessInstructions=2
[attempt 1  ] committed signature=3nF…
[attempt -  ] replay    phase 2 — same intent, rebuilt transaction, same idempotency key
[attempt 1  ] send      phase 2 blockhash=9kD… priorityFee=1000µLamports sig=7aB… businessInstructions=1
[attempt 1  ] blocked   AlreadyCommitted (code 6000) — duplicate blocked, the counter was not incremented again

Result
  phase 1          committed after 1 attempt(s)
  phase 2          duplicate-blocked after 1 attempt(s)
  count before     null
  count after      1
  increments       n/a (counter was created)
  receipt status   committed
  receipt matches  true (true means the stored fingerprint is this same intent)
```

What to check:

- `phase 2` reports `duplicate-blocked`, not `committed`.
- `count after` is `1`, not `2`.
- Note the phase 2 line: it sends `businessInstructions=1`, because the counter exists by
  then and `initialize` is omitted. The guard still recognises the rebuilt attempt as a
  duplicate, because the fingerprint does not depend on which instructions were needed to
  carry the intent out.

If the counter already exists when you run it, `count before` is a number and the increment
count in the result block is `1`; if the counter does not exist, it is created and
incremented in the same guarded transaction.

On an ambiguous first attempt you will see a `retry` line instead, naming what changed:

```text
[attempt 1  ] retry     blockhash expired before confirmation — rebuilding with fresh blockhash, priorityFee 1000 -> 2000µLamports, idempotency key unchanged (order_928)
```

## Two failures that must not be conflated

- **`AlreadyCommitted` (6000)** — the receipt exists with the *same* payload fingerprint. The
  intent already committed; this transaction was aborted. Nothing to do.
- **`IdempotencyConflict` (6001)** — the receipt exists with a *different* fingerprint. The
  key was reused for something else. The script stops and reports it rather than retrying:
  retrying unchanged would fail forever, and retrying with a new key would execute a second,
  different action.

`demo-counter`'s own error (`Overflow`, code 6000 in *its* program) is a different program's
error space and is not conflated with these: `classifyError` reads the custom error code out
of the transaction error, and the guard's codes 6000–6010 are the ones it maps.

## Why the idempotency key is semantic

The key is `ORDER_ID`, and the payload fingerprint is:

```ts
{ action: 'demo-counter:increment', program, counter, orderId, memo }
```

Nothing about the transport is in it — no blockhash, no priority fee, no compute budget, no
signature, no retry counter, no submission route. Every one of those changes when a
transaction is rebuilt, so including any of them would make attempt 2 look like a *different*
intent: the guard would answer `IdempotencyConflict` instead of `AlreadyCommitted`, and a
rebuilt retry would be treated as a brand new action and increment the counter again. That is
the whole product defeated, by one field in a hash.

The counter's *current value* is deliberately excluded too. It is observed state, not intent:
if another transaction incremented the counter between two attempts, folding the value in
would turn an honest retry into a reported conflict where there is none. Whether `initialize`
was needed is excluded for the same reason — it describes the state of the world at build
time, not what the user asked for.

## Placeholders and unverified details

- **Compute budget instruction is hand-encoded.** `setComputeUnitPriceInstruction` writes the
  `SetComputeUnitPrice` wire format by hand (program `ComputeBudget111111111111111111111111111111`,
  tag `3`, u64 micro-lamports little-endian) because this repository does not depend on
  `@solana-program/compute-budget` and the example must not import a package that is not
  installed. If you add that package, replace the helper with its
  `getSetComputeUnitPriceInstruction({ microLamports })`. This is one of two places in this
  example where an interface outside the repository is encoded rather than imported.
- **The `demo-counter` instruction builders are hand-written**, because no generated
  JavaScript client for that program is checked in. The discriminators
  (`increment` = `0b12680968ae3b21`, `initialize` = `afaf6d1f0d989bed`, `Counter` account =
  `ffb004f5bcfd7c19`) are copied from `target/idl/demo_counter.json`, and the script asserts at
  startup that each equals `sha256("<namespace>:<name>")[0..8]` — so a stale hardcoded value
  fails immediately with an explanatory message instead of producing an opaque
  `InstructionFallbackNotFound` on chain. The counter PDA seeds (`[b"counter", owner]`), the
  account roles, and the `Counter` layout (88 bytes; `count` as a u64 at offset 40) come from
  `programs/demo-counter/src/lib.rs`. For your own program, generate a client from its IDL
  instead of copying this pattern.

## Status

**This example has not been executed against a live cluster.** It has been run only far
enough to confirm that it loads, resolves its imports, passes its three discriminator
assertions against `sha256` (so the hand-copied IDL values are correct), derives the counter
PDA and the receipt PDA, and reports a clear error when `RPC_URL` or `KEYPAIR` is missing. No
transaction was submitted, and nothing here has been tested against a deployed CommitOnce
program or a deployed `demo-counter` program. Treat the expected output above as the shape of
the output, not as captured evidence.

It **does** typecheck: this example is part of the workspace, so `pnpm -r typecheck` compiles
it against the real SDK. A change to the SDK that breaks this file fails the build.

## Security note

**The guard protects only transactions that actually include it.** It is a property of a
transaction, not of an account, a program, or an instruction. If the same logical action can
be performed through any other path — a different code path in your app, a manual CLI call,
an admin tool, another program's CPI that does not prepend `claim` — that path is completely
unprotected. Closing that hole requires that every path which can perform this action builds
its transaction through the guard, with the same `(authority, namespace, idempotency key)`
tuple. A second path with a different namespace or a different key is a second, unprotected
path.

Note also that `demo-counter`'s `initialize` is idempotent by construction (it fails if the
account exists) but that is the *program's* property, not the guard's. The guard answers "has
this logical intent already committed?"; it does not make the wrapped program idempotent, and
a program being idempotent does not tell you whether a logical intent already happened.

Two further boundaries, both deliberate:

- **The window is finite unless you choose `permanent`.** After a receipt expires and is
  cleaned up, the key can be claimed again. `permanent` costs its rent deposit forever.
- **The authority is a single key.** There is no multisig or threshold authority today.
