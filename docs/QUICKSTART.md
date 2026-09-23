# CommitOnce quickstart

Zero to a guarded transaction, then a duplicate getting blocked.

**What you are getting.** One instruction, `commit_once::claim`, prepended to the *same
atomic transaction* as your business instructions. It creates a receipt PDA keyed by
`(authority, namespace, idempotency key)`. If the receipt already exists, the instruction
errors and the whole transaction reverts, so your business instructions never run.

The guarantee is **at-most-once successful execution of a guarded logical intent within the
configured retention window.** It is not "exactly once": CommitOnce prevents a second
execution, it does not make the first one land. Keep retrying until success and you get
exactly-once-style application semantics.

The program is **unaudited**, and this repository does not claim that it is deployed
anywhere. Paths A and C below need no cluster at all.

---

## Prerequisites

| Requirement | Version | Needed for |
| --- | --- | --- |
| Node.js | **20.18.0 or newer** (`engines.node` in both `package.json` files) | Paths A and B |
| pnpm | 11 (the repo pins `packageManager: pnpm@11.24.0`) | installing and building |
| Rust + Solana/Anchor toolchain | Rust 1.89.0 (`rust-toolchain.toml`) | Path C (builds and runs the on-chain tests) |
| A Solana cluster, a funded keypair, and the program deployed on it | — | Path B (a live send) |

Path A takes a couple of minutes and needs nothing but Node and pnpm. Path C is the fastest
way to see the guard block a real duplicate on a real SVM. Path B is the only one that
touches a network.

If you are on Windows PowerShell and it refuses to run `pnpm.ps1` ("running scripts is
disabled on this system"), use `pnpm.cmd` instead of `pnpm`, or run the commands from
`cmd.exe`.

---

## Path A — build a guarded transaction (no cluster, ~2 minutes)

### Step 1. Install

```bash
git clone https://github.com/KaiVenn52/commitonce.git
cd commitonce
pnpm install
```

### Step 2. Build the SDK

`dist/` is gitignored, so a fresh clone has no build output:

```bash
pnpm --filter @commitonce/solana build
```

Expected output:

```text
built dist/esm, dist/cjs, dist/types
```

You can sanity-check the install without writing any code:

```bash
pnpm --filter @commitonce/solana test
node packages/sdk/scripts/print-vectors.mjs
```

The first runs 71 tests, including the cross-language vectors. The second recomputes those
same vectors from `@solana/kit` primitives *without importing the SDK*, and ends with:

```text
=== receipt rent at mainnet rates ===
(202 data bytes + 128 overhead) * 5080 lamports/byte = 1676400 lamports
```

### Step 3. Write the script

Create `packages/sdk/quickstart.mjs`. Put it in that directory: Node's package
self-reference is what lets the file import `@commitonce/solana` by name, and
`@solana/kit` is already installed next to it.

```js
// packages/sdk/quickstart.mjs
//
// Runs entirely offline: the only I/O is WebCrypto hashing and local signing.
import { bytesToHex, classifyError, isAlreadyCommitted, prepareIntent } from '@commitonce/solana';
import {
    appendTransactionMessageInstructions, createTransactionMessage, generateKeyPairSigner,
    getSignatureFromTransaction, pipe, setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners,
} from '@solana/kit';

// The authority: the key that signs your business transaction and pays the receipt rent.
const authority = await generateKeyPairSigner();

// One logical intent. The payload carries semantic content only.
const intent = { to: 'alice', mint: 'USDC', amount: 10_000_000n };

// 1. Build the guard. Pure: no RPC, no prover, no indexer.
const guard = await prepareIntent({
    authority: authority.address,
    namespace: 'payments:transfer',
    idempotencyKey: 'order_928',
    intent,
    retention: '24h',
});

console.log('program   ', guard.programAddress);
console.log('receipt   ', guard.receipt, '(bump ' + guard.receiptBump + ')');
console.log('namespace ', bytesToHex(guard.namespaceHash));
console.log('key       ', bytesToHex(guard.idempotencyKeyHash));
console.log('payload   ', bytesToHex(guard.payloadHash));
console.log('retention ', guard.retentionSeconds, 'seconds');
console.log('refund to ', guard.refundDestination);
console.log('data      ', guard.instruction.data.length, 'bytes');
console.log('accounts  ', guard.instruction.accounts.map((a) => a.address));

// 2. Prepend the guard to the business instructions, in ONE atomic transaction.
const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(authority, m),
    (m) => appendTransactionMessageInstructions([guard.instruction], m),
    // Any base58 blockhash is fine for a local signing check. Fetch a real one to send.
    (m) => setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1n },
        m,
    ),
);
const signed = await signTransactionMessageWithSigners(message);
console.log('signature ', getSignatureFromTransaction(signed));

// 3. A rebuild must produce the same guard, byte for byte. If it did not, a retry would
//    look like a new intent and the guard would protect nothing.
const rebuilt = await prepareIntent({
    authority: authority.address,
    namespace: 'payments:transfer',
    idempotencyKey: 'order_928',
    intent: { amount: 10_000_000n, mint: 'USDC', to: 'alice' }, // different key order
    retention: 86_400,                                          // different spelling
});
console.log('same receipt', rebuilt.receipt === guard.receipt);
console.log('same bytes  ', bytesToHex(rebuilt.instruction.data) === bytesToHex(guard.instruction.data));

// 4. This is what a blocked duplicate looks like once the RPC reports it.
const rpcError = { context: { err: { InstructionError: [0, { Custom: 6000 }] } } };
const classified = classifyError(rpcError);
console.log('classified  ', classified.kind === 'commit-once' ? classified.name : classified.kind);
console.log('duplicate?  ', isAlreadyCommitted(rpcError));
```

### Step 4. Run it

```bash
node packages/sdk/quickstart.mjs
```

Expected output (the keypair is generated per run, so the receipt, refund address and
signature differ every time):

```text
program    CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB
receipt    7nNZmzs9QowLbu3cJhzLTUYdZW3undTamx8W8CXDXjbk (bump 252)
namespace  9e7bb3a4dce399c675e567cec2312197966a9dd8ab00b93834b82ead8a49cde3
key        0a9ba9a57e3b998c5807159e02e362f2d14c85cfe02e5b508e7f2cfd2d3d4e0d
payload    9712c02a4d86dceb9f3b8de0a591491452b53cf6485ea5da9c39bf32a8f53953
retention  86400n seconds
refund to  3j3BMSvigtiTwsJMkyTbMKZtaeuM2YaUoX8CbmV49AJ8
data       144 bytes
accounts   [
  '3j3BMSvigtiTwsJMkyTbMKZtaeuM2YaUoX8CbmV49AJ8',
  '7nNZmzs9QowLbu3cJhzLTUYdZW3undTamx8W8CXDXjbk',
  'Sysvar1nstructions1111111111111111111111111',
  '11111111111111111111111111111111'
]
signature  5cuXBh7cv2Trv3znTYXayDXku1cWUbtCJpr7J2MMkBhHuaFN7Vg1uyMomPh3jvkusE3zxZc1gTVGCTVGC7fsdkVk
same receipt true
same bytes   true
classified   AlreadyCommitted
duplicate?   true
```

### Step 5. What that just proved

* The guard for a given `(authority, namespace, key)` is fully determined locally. There is
  no RPC, no prover and no indexer in the path — `prepareIntent` is pure.
* The receipt address is a function of the authority, the namespace and the key. Two
  spellings of the same retention (`'24h'` and `86_400`) and a different key order in the
  payload object produce the **same** instruction bytes, because the payload encoding sorts
  object keys and the retention parser normalises durations. If they differed, every retry
  would look like a new intent and the guard would protect nothing.
* `AlreadyCommitted` (code 6000) is what a blocked duplicate looks like, and
  `classifyError` recognises it even when it is nested inside an RPC error object.

The next step is to put a real business instruction in the list and send it.

---

## Path B — send it, and watch the duplicate get blocked

This path needs a cluster where `commit_once` actually exists. **This repository does not
ship a deployment.** You have to deploy it yourself:

```bash
# Requires the Solana CLI + Anchor 1.2.0 and a funded deployer keypair.
anchor build --arch v2          # or: bash scripts/build.sh
anchor deploy --provider.cluster devnet
```

`anchor deploy` needs a keypair at `target/deploy/commit_once-keypair.json` whose pubkey
matches `declare_id!`; `scripts/build.sh` copies the keypairs from `deploy-keys/` and
verifies that pairing, which is why it is the recommended entry point. `deploy-keys/`
**is** committed — a program's address is derived from its keypair, so without them a fresh
clone cannot build an artifact matching `declare_id!`. See `deploy-keys/README.md` for why
that is safe for these devnet keys and why a mainnet deployment must generate its own.

Then write `packages/sdk/send-guarded.mjs`:

```js
// packages/sdk/send-guarded.mjs
//
// KEYPAIR=/path/to/id.json RECIPIENT=<address> node packages/sdk/send-guarded.mjs
import { readFileSync } from 'node:fs';
import { classifyError, isAlreadyCommitted, prepareIntent } from '@commitonce/solana';
import {
    appendTransactionMessageInstructions, createKeyPairSignerFromBytes, createSolanaRpc,
    createSolanaRpcSubscriptions, createTransactionMessage, devnet, getSignatureFromTransaction,
    pipe, sendAndConfirmTransactionFactory, setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';

const rpc = createSolanaRpc(devnet('https://api.devnet.solana.com'));
const rpcSubscriptions = createSolanaRpcSubscriptions(devnet('wss://api.devnet.solana.com'));
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

// A Solana CLI keypair file is a JSON array of 64 bytes.
const authority = await createKeyPairSignerFromBytes(
    new Uint8Array(JSON.parse(readFileSync(process.env.KEYPAIR, 'utf8'))),
);

const recipient = process.env.RECIPIENT;
const amount = 1_000_000n; // 0.001 SOL

// The intent is stable across attempts. The idempotency key identifies it; the payload
// describes it. Neither contains anything that changes when the transaction is rebuilt.
const intent = { to: recipient, lamports: amount };

async function attempt(label) {
    const guard = await prepareIntent({
        authority: authority.address,
        namespace: 'quickstart:sol-transfer',
        idempotencyKey: 'order_928',
        intent,
        retention: '24h',
    });

    const latest = await rpc.getLatestBlockhash().send();
    const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(authority, m),
        (m) => appendTransactionMessageInstructions(
            [
                guard.instruction, // <- the guard, first
                getTransferSolInstruction({ source: authority, destination: recipient, amount }),
            ],
            m,
        ),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
    );

    const signed = await signTransactionMessageWithSigners(message);
    await sendAndConfirm(signed, { commitment: 'confirmed' });
    console.log(label, 'confirmed', getSignatureFromTransaction(signed));
    console.log(label, 'receipt  ', guard.receipt);
}

// Attempt 1: commits. The receipt is created and the transfer executes.
try {
    await attempt('attempt 1');
} catch (e) {
    console.error('attempt 1 failed:', e);
}

// Attempt 2: a REBUILT transaction for the same intent — fresh blockhash, new bytes, new
// signature. This is exactly what a client does after an ambiguous timeout.
try {
    await attempt('attempt 2');
    console.log('attempt 2 landed: the guard did not block it');
} catch (e) {
    const classified = classifyError(e);
    console.log('attempt 2 blocked:', classified.kind === 'commit-once' ? classified.name : classified.kind);
    console.log('is duplicate      :', isAlreadyCommitted(e));
}
```

```bash
KEYPAIR=~/.config/solana/id.json RECIPIENT=<a devnet address> node packages/sdk/send-guarded.mjs
```

Expected behaviour:

| Attempt | Result |
| --- | --- |
| 1 | `confirmed <signature>`, receipt created |
| 2 | fails with `AlreadyCommitted` (6000); `isAlreadyCommitted` returns `true`; the recipient's balance is unchanged by the second attempt |

The two attempts are genuinely different transactions — different blockhash, different
message bytes, therefore a different signature — which is why the runtime's message-hash
deduplication cannot connect them. The receipt can. To confirm the business action did not
run twice, compare the recipient's balance (or, for a program with its own state, read that
state) before and after.

If attempt 2 instead reports `IdempotencyConflict` (6001), the key `order_928` was already
used with a different payload under this authority. Use a different key, or reuse the
original payload. See [`INTEGRATION_PLAYBOOK.md`](./INTEGRATION_PLAYBOOK.md) §8.

---

## Path C — the fastest on-chain proof, without a cluster

The Rust test suite executes the **real compiled SBF program** through LiteSVM. It does not
need a validator, an RPC endpoint or a funded account, and it asserts on observable on-chain
state (a counter owned by a separate program that knows nothing about CommitOnce) rather
than on error strings.

```bash
# Build both programs (needed once: *.so and target/ are gitignored).
bash scripts/build.sh

# Run everything.
bash scripts/test.sh

# Or just the A/B pair, with output visible:
bash scripts/test.sh --test invariant -- --nocapture
```

Expected result for the invariant file (as observed in this checkout — 10 tests, all
passing):

```text
running 10 tests
...
test without_guard_two_rebuilt_transactions_execute_twice ... ok
test with_guard_rebuilt_retry_is_blocked_and_business_action_runs_once ... ok
...
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

Those two tests are the whole product in one screen:

* `without_guard_two_rebuilt_transactions_execute_twice` — the baseline. Two transactions for
  the same logical action, each built against the blockhash that was current when it was
  built (exactly what a client does after losing a response). Both land. The counter reads
  **2**.
* `with_guard_rebuilt_retry_is_blocked_and_business_action_runs_once` — the same scenario with
  the guard prepended. The retry is a genuinely different signed transaction, it is rejected
  with custom error **6000**, and the counter reads **1**.

Two things to know before you run them:

* The scripts assume a Linux/WSL toolchain — they export a specific `HOME` and `PATH`. On
  your own machine, set `CARGO_TARGET_DIR` (where the build cache and `.so` files go) and
  `COMMIT_ONCE_DEPLOY_DIR` (where the tests look for the `.so` files, default
  `$CARGO_TARGET_DIR/deploy`, with a fallback to `<repo>/target/deploy`).
* The suite overrides the `SysvarRent` sysvar with live mainnet values, because LiteSVM's
  default comes from a stale crate constant (see the cost section below). Without that
  override every rent figure the tests report would be wrong by more than a third.

---

## What a guarded intent costs

| Item | Value |
| --- | --- |
| Receipt account | 202 bytes |
| Rent deposit per live receipt | **1,676,400 lamports** (~0.00168 SOL) |
| Refunded on cleanup | the full deposit, after both deadlines have passed |
| Extra accounts in the transaction | 1 writable (the receipt) + 2 read-only system accounts |
| `claim` instruction data | 144 bytes |
| Compute units | not quoted here — measure them (below) |
| Transaction fee / priority fee | whatever the network and your client already pay |

The deposit is `(202 data bytes + 128 account overhead) × 5080 lamports/byte`, at the
mainnet rate in effect since **SIMD-0437 step 2**. It is not hardcoded: `claim` calls
`Rent::get()?.minimum_balance(202)`, so it follows the cluster's rent sysvar. Permanent
receipts (`retention: 'permanent'`) never refund it.

The `solana-rent` Rust crate still ships an effective **6960 lamports/byte**
(`DEFAULT_LAMPORTS_PER_BYTE_YEAR = 3480` with an exemption threshold of `2.0`), so any
deposit figure derived from that crate is **37% too high**. That is why the Rust test
harness overrides the sysvar with the live mainnet values before anything runs.

To measure the compute-unit overhead on your own machine instead of trusting a number:

```bash
bash scripts/test.sh --test benchmarks -- --nocapture
```

That test prints measured compute units for the bare business action, `claim` alone, a
guarded first attempt, a blocked duplicate and cleanup, plus the measured wire-size delta,
the account delta, the receipt data length and the measured deposit.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ERR_MODULE_NOT_FOUND: Cannot find package '@commitonce/solana'` | The script is outside `packages/sdk/`, so the package name does not resolve | Keep the script in `packages/sdk/`, or link the package into your own project |
| `Cannot find module '…/dist/esm/index.js'` | The SDK has not been built (`dist/` is gitignored) | `pnpm --filter @commitonce/solana build` |
| `CommitOnce: WebCrypto is unavailable` | Node older than 18, or a browser without a secure context | Use Node 20.18+, or hash with your own SHA-256 and use `encodeClaimData` + `deriveReceiptAddress` |
| `custom program error: 0x1770` (6000) | `AlreadyCommitted` — the intent already committed | Expected on a retry. Treat it as success; do not retry again |
| `custom program error: 0x1771` (6001) | `IdempotencyConflict` — the key was reused for a different payload | Use a new key, or reuse the original payload. Never retry blindly |
| `custom program error: 0x1772` (6002) | Durable-nonce transaction with finite retention | Use `retention: 'permanent'`, or drop the nonce |
| `custom program error: 0x1773` (6003) | Retention outside `0` or `[3600, 31536000]` | Fix the value; `parseRetention`/`assertValidRetention` catch this locally |
| `custom program error: 0x1779` (6009) | `close_receipt` before both deadlines passed | Wait; both the slot and wall-clock deadlines must pass |
| `custom program error: 0x177A` (6010) | `close_receipt` on a permanent receipt | Nothing to do: it can never be closed |
| Instruction fails at index 0 with `InvalidAccountData`, or the receipt account is missing | The program is not deployed at `CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB` on the cluster you are using | Deploy it, or point `programAddress` at your own deployment |
| `No compiled program found in …` from `scripts/test.sh` | The `.so` files are not where the script looks | `bash scripts/build.sh`, or set `COMMIT_ONCE_DEPLOY_DIR` |
| PowerShell: `pnpm.ps1 cannot be loaded` | Execution policy | Use `pnpm.cmd`, or run from `cmd.exe` |

---

## Where to go next

| | |
| --- | --- |
| Understand the model before integrating | [`CONCEPTS.md`](./CONCEPTS.md) |
| Add the guard to an existing application | [`INTEGRATION_PLAYBOOK.md`](./INTEGRATION_PLAYBOOK.md) |
| Look up a signature, offset or error code | [`API_REFERENCE.md`](./API_REFERENCE.md) |
| Hard questions, direct answers | [`FAQ.md`](./FAQ.md) |
| The implementation and its known limitations | [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`SECURITY_MODEL.md`](./SECURITY_MODEL.md) |
