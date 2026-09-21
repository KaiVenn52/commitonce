# CommitOnce — API reference

Exhaustive reference for the on-chain program and the TypeScript SDK.

**Status: unaudited.** Program `commit_once` v0.1.0, SDK `@commitonce/solana` v0.1.0. The
program has no independent review, and this repository makes no claim that any deployment
exists on any cluster. Everything below is derived from
`programs/commit-once/src/**`, `packages/sdk/src/**` and the generated IDL at
`target/idl/commit_once.json`.

Concepts are in [`CONCEPTS.md`](./CONCEPTS.md); integration guidance is in
[`INTEGRATION_PLAYBOOK.md`](./INTEGRATION_PLAYBOOK.md).

---

## 1. Program identity

| Item | Value |
| --- | --- |
| Program name | `commit_once` |
| Program address | `CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB` |
| Instructions | `claim`, `close_receipt` |
| Accounts | `IntentReceipt` |
| Events | `IntentCommitted`, `IntentReceiptClosed` |
| Custom error range | 6000–6010 |
| Account size | 202 bytes |

The address is compiled in via `declare_id!` and is derived from
`deploy-keys/commit_once-keypair.json`. Because `declare_id!` is part of the program, **a
program deployed at any other address refuses to run**, so the address is identical on every
cluster and `scripts/build.sh` verifies that pairing after each build. The SDK's
`programAddress` override exists for local testing and for a self-deployed copy, not for
pointing at a "different mainnet CommitOnce".

---

## 2. Instruction `claim`

Claims a logical intent. Creates the receipt PDA when it is absent; when it is present, the
instruction always fails, so that the business instructions after it never run.

### 2.1 Accounts

Four accounts, in this order. The order is load-bearing: the `receipt` seeds reference
`authority`, so `authority` must be declared first.

| # | Name | Signer | Writable | Address constraint | Purpose |
| --- | --- | --- | --- | --- | --- |
| 0 | `authority` | yes | yes | — | The intent authority. Pays the receipt's rent deposit. Bound into the receipt PDA seeds, which is what makes keys authority-scoped. Must be a signer of the transaction. |
| 1 | `receipt` | no | yes | PDA, `seeds = [b"commit-once", authority, namespace_hash, idempotency_key_hash]`, canonical `bump` | The intent receipt. Created by this instruction when absent. Declared as an unchecked account; ownership, discriminator and contents are verified in the handler before any pre-existing account is trusted. |
| 2 | `instructions_sysvar` | no | no | `Sysvar1nstructions1111111111111111111111111` | Instructions sysvar. Read to detect durable-nonce transactions. |
| 3 | `system_program` | no | no | `11111111111111111111111111111111` | Used only to create the receipt account (`create_account` via `invoke_signed`). |

Notes:

* `authority` is writable because it pays the rent deposit directly. A relayer can still pay
  the *transaction fee*; the fee payer and the authority are independent roles.
* `receipt` is not a signer: it is a PDA created with `invoke_signed` using the same seeds.
* Keeping the account set to four minimises per-transaction byte overhead.

### 2.2 Arguments

| Name | Type | Units / encoding | Notes |
| --- | --- | --- | --- |
| `namespace_hash` | `[u8; 32]` | `sha256("commitonce/namespace/v1" ‖ namespace_utf8)` | Opaque to the program. Part of the PDA seeds. |
| `idempotency_key_hash` | `[u8; 32]` | `sha256("commitonce/key/v1" ‖ idempotency_key_utf8)` | Opaque to the program. Part of the PDA seeds. |
| `payload_hash` | `[u8; 32]` | caller-chosen fingerprint | Stored on the receipt and compared on a duplicate. Defines "the same intent". |
| `retention_seconds` | `u64` | seconds; `0` means permanent | Accepted range: `0`, or `3600 … 31536000` inclusive. |
| `refund_destination` | `pubkey` | 32-byte address | Where the rent deposit goes after expiry. Must not be `Pubkey::default()` and must not be the receipt PDA. Immutable once written. |

Hashing happens client-side. That keeps unbounded strings out of PDA seeds, keeps the
instruction data fixed-size, and makes the derivation a single testable cross-language
definition (see §9).

### 2.3 Instruction data layout

144 bytes, Borsh-serialised, little-endian integers.

| Offset | Size | Field | Encoding |
| --- | --- | --- | --- |
| 0 | 8 | discriminator | `sha256("global:claim")[0..8]` = `3e c6 d6 c1 d5 9f 6c d2` |
| 8 | 32 | `namespace_hash` | raw bytes |
| 40 | 32 | `idempotency_key_hash` | raw bytes |
| 72 | 32 | `payload_hash` | raw bytes |
| 104 | 8 | `retention_seconds` | `u64`, little-endian |
| 112 | 32 | `refund_destination` | raw 32-byte pubkey |
| **144** | | **total** | |

The SDK builds these bytes by hand (`encodeClaimData`) rather than through a generated
client, so the layout is auditable in one place and the package stays dependency-free.
`CLAIM_DATA_LENGTH` is `8 + 32 + 32 + 32 + 8 + 32 = 144`.

### 2.4 Evaluation order and errors

Checks run in this order. The order matters when you are debugging a rejected transaction:
the first failing check is the error you see.

| Step | Condition | Error |
| --- | --- | --- |
| 1 | `retention_seconds` is not `0` and not in `[3600, 31536000]` | `InvalidRetention` (6003) |
| 2 | `refund_destination == Pubkey::default()` | `InvalidRefundDestination` (6004) |
| 3 | `refund_destination == receipt PDA` | `InvalidRefundDestination` (6004) |
| 4 | retention is finite **and** the transaction contains an `AdvanceNonceAccount` instruction | `DurableNonceUnsupported` (6002) |
| 5 | receipt account does not exist | *(no error — the receipt is created and the transaction continues)* |
| 6 | an account exists at the PDA but is not owned by this program | `InvalidReceiptOwner` (6005) |
| 7 | the account's data does not deserialise as an `IntentReceipt` | Anchor framework error (`AccountDidNotDeserialize`) |
| 8 | stored `version != 1` | `UnsupportedReceiptVersion` (6008) |
| 9 | stored `authority !=` the signing authority | `InvalidReceiptAuthority` (6007) |
| 10 | stored `namespace_hash` or `idempotency_key_hash` differs from the instruction's | `InvalidReceiptData` (6006) |
| 11 | stored `payload_hash ==` the instruction's | `AlreadyCommitted` (6000) |
| 12 | stored `payload_hash !=` the instruction's | `IdempotencyConflict` (6001) |

Framework-level failures can also occur before the handler body runs, and they carry
Anchor's own error codes rather than 6000-range codes:

* `authority` is not a signer → Anchor `Signer` constraint failure.
* `receipt` does not match the PDA seeds/bump → Anchor `ConstraintSeeds` failure.
* `instructions_sysvar` or `system_program` is not the real account → Anchor `address`
  constraint failure. If a substituted sysvar somehow reached the reader, the
  instructions-sysvar loader itself returns `UnsupportedSysvar`; the `address` constraint is
  what makes that unreachable in practice.

### 2.5 Effects on success

1. A 202-byte `IntentReceipt` account is created at the PDA, owned by the program, holding
   exactly the cluster's rent-exempt minimum for that size (`Rent::get()?.minimum_balance(202)`).
2. `IntentCommitted` is emitted.
3. Execution continues with the next instruction in the transaction.

If any later instruction fails, all of this is rolled back, including the rent transfer.

---

## 3. Instruction `close_receipt`

Closes an expired receipt and returns its rent deposit to the destination recorded at claim
time. Permissionless: anyone may submit it.

### 3.1 Accounts

| # | Name | Signer | Writable | Constraint | Purpose |
| --- | --- | --- | --- | --- | --- |
| 0 | `receipt` | no | yes | `Account<'info, IntentReceipt>` — owner and discriminator enforced by Anchor; closed with `close = refund_destination` | The receipt to close. |
| 1 | `refund_destination` | no | yes | `address = receipt.refund_destination` | Receives the deposit. Constrained to the immutable value stored on the receipt, which is what makes permissionless cleanup safe. |

### 3.2 Arguments

None.

### 3.3 Instruction data layout

8 bytes: the discriminator only.

| Offset | Size | Field | Encoding |
| --- | --- | --- | --- |
| 0 | 8 | discriminator | `sha256("global:close_receipt")[0..8]` = `7e fe f4 cb 7c a4 86 59` |

### 3.4 Evaluation order and errors

| Step | Condition | Error |
| --- | --- | --- |
| 0 | `refund_destination != receipt.refund_destination` | Anchor `ConstraintAddress` failure (checked before the handler body) |
| 1 | the account at `receipt` is not an owned, decodable `IntentReceipt` | Anchor framework error (`AccountOwnedByWrongProgram` / `AccountDiscriminatorMismatch`) |
| 2 | the receipt is permanent (`expires_at_slot == 0`) | `ReceiptIsPermanent` (6010) |
| 3 | `clock.slot < expires_at_slot` | `ReceiptNotExpired` (6009) |
| 4 | `clock.unix_timestamp < expires_at_unix_ts` | `ReceiptNotExpired` (6009) |

**Both** deadlines must have passed. A close attempt that fails leaves the receipt in place
and untouched.

### 3.5 Effects on success

1. `IntentReceiptClosed` is emitted.
2. The account is closed: its lamports are transferred to `refund_destination` and the
   account data is zeroed. The deposit is refunded in full — no fee is taken by the program.
3. The `(authority, namespace, key)` tuple becomes claimable again. This is deliberate and
   documented: the protection window ends at cleanup.

---

## 4. Account `IntentReceipt`

202 bytes, fixed size, explicitly versioned, so indexers and the SDK can decode it without
an IDL round trip. Offsets and sizes are asserted by `receipt_account_layout_is_exactly_202_bytes`
(Rust) and by `packages/sdk/test/vectors.test.ts`.

| Offset | Size | Field | Type | Meaning |
| --- | --- | --- | --- | --- |
| 0 | 8 | discriminator | `[u8; 8]` | `sha256("account:IntentReceipt")[0..8]` = `54 fc 5d 64 7e 50 0f 86` |
| 8 | 1 | `version` | `u8` | Layout version written by this program version: `1`. `0` is reserved as "not a receipt". |
| 9 | 1 | `bump` | `u8` | Canonical PDA bump. |
| 10 | 32 | `authority` | `pubkey` | The claiming authority. Also bound through the PDA seeds. |
| 42 | 32 | `namespace_hash` | `[u8; 32]` | As supplied to `claim`. |
| 74 | 32 | `idempotency_key_hash` | `[u8; 32]` | As supplied to `claim`. |
| 106 | 32 | `payload_hash` | `[u8; 32]` | The stored fingerprint. Immutable after creation. |
| 138 | 32 | `refund_destination` | `pubkey` | Immutable rent refund destination. |
| 170 | 8 | `created_slot` | `u64` LE | Slot at which the receipt was created. |
| 178 | 8 | `expires_at_slot` | `u64` LE | Slot deadline. **`0` means permanent.** |
| 186 | 8 | `created_unix_ts` | `i64` LE | Wall-clock creation time, for indexing. |
| 194 | 8 | `expires_at_unix_ts` | `i64` LE | Wall-clock deadline. **`0` means permanent.** |

`version` and `bump` are the only two fields not written by the caller or read from the
clock. The rent-exempt minimum for 202 bytes is 1,676,400 lamports at the mainnet rate of
5080 lamports/byte since SIMD-0437 step 2 — see §8.

---

## 5. Events

| Event | Discriminator (`sha256("event:…")[0..8]`) | Fields |
| --- | --- | --- |
| `IntentCommitted` | `04 f9 49 33 d8 6e c4 f9` | `authority: pubkey`, `namespace_hash: [u8;32]`, `idempotency_key_hash: [u8;32]`, `payload_hash: [u8;32]`, `refund_destination: pubkey`, `created_slot: u64`, `expires_at_slot: u64`, `created_unix_ts: i64`, `expires_at_unix_ts: i64` |
| `IntentReceiptClosed` | `bb 5b ae af 26 db b5 6c` | `authority: pubkey`, `namespace_hash: [u8;32]`, `idempotency_key_hash: [u8;32]`, `payload_hash: [u8;32]`, `closed_slot: u64` |

`IntentCommitted` is emitted once per receipt, i.e. once per first successful commit of an
intent — it is the event to count if you want "how many guarded intents committed".
`IntentReceiptClosed` is emitted by cleanup. Neither event is emitted for a blocked
duplicate: `claim` logs a message and returns an error, and the transaction's logs are all
that remains.

---

## 6. Program constants

These are exported in the IDL (`target/idl/commit_once.json`) except where noted.

| Constant | Type | Value | Meaning |
| --- | --- | --- | --- |
| `RECEIPT_SEED` | bytes | `b"commit-once"` (11 bytes) | PDA seed prefix. |
| `RECEIPT_VERSION` | `u8` | `1` | Account layout version. |
| `PERMANENT_RETENTION` | `u64` | `0` | Retention sentinel: never expires, can never be closed. |
| `MIN_RETENTION_SECONDS` | `u64` | `3600` | Shortest accepted non-zero retention. |
| `MAX_RETENTION_SECONDS` | `u64` | `31536000` | Longest accepted finite retention (365 days). |
| `SLOTS_PER_SECOND` | `u64` | `4` | Slot-rate assumption (250 ms slots since epoch 1036) used to derive `expires_at_slot`. |
| `ADVANCE_NONCE_ACCOUNT_DISCRIMINATOR` | `u32` | `4` | System Program `AdvanceNonceAccount` discriminator, used for nonce detection. |
| `MAX_INSTRUCTION_SCAN` | `usize` | `128` | Upper bound on instructions scanned for nonce semantics. Deliberately **not** in the IDL: it is an implementation detail. |

---

## 7. Error codes

Anchor numbers custom program errors from 6000 upwards, in enum declaration order. This
table matches `programs/commit-once/src/error.rs`, the IDL, and
`COMMIT_ONCE_ERROR_CODES` in the SDK. A test asserts the SDK list against the IDL so a
reordering of the Rust enum cannot be misread by a caller.

| Code | Hex | Name | Raised when | What a caller should do |
| --- | --- | --- | --- | --- |
| 6000 | `0x1770` | `AlreadyCommitted` | A receipt exists for this `(authority, namespace, key)` with a matching payload fingerprint. | Treat as **success**: the intent already committed. Do not retry; do not surface an error to the user. |
| 6001 | `0x1771` | `IdempotencyConflict` | A receipt exists, but its stored payload fingerprint differs. | **Hard failure.** The key was reused for a different action. Do not retry, do not reuse the key; alert and investigate. The stored fingerprint is not overwritten. |
| 6002 | `0x1772` | `DurableNonceUnsupported` | The transaction contains an `AdvanceNonceAccount` instruction and retention was finite. | Use `retention: 'permanent'`, or drop the durable nonce. |
| 6003 | `0x1773` | `InvalidRetention` | `retention_seconds` was neither `0` nor within `[3600, 31536000]`. | Fix the retention value. The SDK rejects this before sending. |
| 6004 | `0x1774` | `InvalidRefundDestination` | `refund_destination` was `Pubkey::default()` or the receipt PDA itself. | Use a real account that is not the receipt. The SDK rejects the receipt case locally. |
| 6005 | `0x1775` | `InvalidReceiptOwner` | An account exists at the receipt PDA but is not owned by this program. | Do not proceed. Either the address was substituted, or something else wrote there; investigate. |
| 6006 | `0x1776` | `InvalidReceiptData` | The receipt's stored `namespace_hash` or `idempotency_key_hash` disagrees with the instruction's. | Do not proceed. With the PDA binding in place this should be unreachable; treat it as an integrity failure. |
| 6007 | `0x1777` | `InvalidReceiptAuthority` | The receipt's stored `authority` disagrees with the signing authority. | Do not proceed. Also should be unreachable given the seeds; treat as an integrity failure. |
| 6008 | `0x1778` | `UnsupportedReceiptVersion` | The receipt's stored `version` is not `1`. | The receipt was written by an incompatible program version. Upgrade the SDK / stop. |
| 6009 | `0x1779` | `ReceiptNotExpired` | `close_receipt` was called before **both** deadlines passed. | Wait. The receipt is untouched; retry after both deadlines. |
| 6010 | `0x177A` | `ReceiptIsPermanent` | `close_receipt` was called on a permanent receipt. | Nothing to do: a permanent receipt can never be closed, and its deposit is never returned. |

For reference, the messages the program attaches to these errors (as they appear in
transaction logs and in the IDL) are:

| Code | On-chain message |
| --- | --- |
| 6000 | `This intent has already been committed` |
| 6001 | `This idempotency key was already used for a different payload` |
| 6002 | `Durable nonce transactions are not supported with expiring retention` |
| 6003 | `Retention must be 0 (permanent) or between 1 hour and 365 days` |
| 6004 | `Invalid refund destination` |
| 6005 | `Receipt account is not owned by the CommitOnce program` |
| 6006 | `Receipt account is malformed` |
| 6007 | `Receipt belongs to a different authority` |
| 6008 | `Unsupported receipt layout version` |
| 6009 | `Receipt has not expired yet` |
| 6010 | `Permanent receipts cannot be closed` |

A blockable duplicate also logs, before returning the error:

```text
CommitOnce: duplicate intent blocked (already committed at slot <created_slot>)
CommitOnce: idempotency conflict - same key, different payload fingerprint
```

These log strings are for humans. Parse the error code, not the log text.

---

## 8. Costs

| Item | Value | Notes |
| --- | --- | --- |
| Receipt account size | 202 bytes | Fixed. |
| Rent-exempt deposit per live receipt | **1,676,400 lamports** (0.00168 SOL) | `(202 data bytes + 128 account overhead) × 5080 lamports/byte`. Mainnet rate since **SIMD-0437 step 2** (epoch 1033). |
| Refund on cleanup | the full deposit | After both deadlines, to the recorded `refund_destination`. Permanent receipts are never refunded. |
| Transaction fee | the cluster's standard fee for the transaction | Set by the network, not by CommitOnce. |
| Priority fee | whatever you set | Unrelated to the guard. |
| Compute units | **not quoted here** | Measure it: `bash scripts/test.sh --test benchmarks -- --nocapture` prints measured CU for the bare action, `claim` alone, a guarded first attempt, a blocked duplicate and cleanup, plus the measured deposit and account size. See §10. |

Two precision points about the rent figure:

* It is **not hardcoded**. `claim` calls `Rent::get()?.minimum_balance(202)`, so the deposit
  follows the cluster's own rent sysvar. 1,676,400 is the mainnet figure.
* The `solana-rent` Rust crate still ships `DEFAULT_LAMPORTS_PER_BYTE_YEAR = 3480` with
  `DEFAULT_EXEMPTION_THRESHOLD = 2.0`, i.e. an effective **6960 lamports/byte** — **37%
  higher** than the live mainnet rate. Any rent estimate produced by that crate (including
  LiteSVM's default sysvar, which the test harness overrides) overstates the deposit by more
  than a third.

Scaling: the deposit is held per live receipt, so N receipts within their windows hold
N × 1,676,400 lamports. 1,000 concurrent receipts ≈ 1,676.4 SOL; a million ≈ 1,676 SOL
locked until cleanup. Permanent receipts hold it forever.

---

## 9. SDK reference — `@commitonce/solana`

* Package name: `@commitonce/solana`, version `0.1.0`.
* Engines: Node `>=20.18.0`. Peer dependency: `@solana/kit ^8.0.0` (developed against
  `8.3.0`).
* Zero runtime dependencies. Hashing uses WebCrypto (`globalThis.crypto.subtle`), which is
  why the hashing helpers are asynchronous.
* Dual ESM/CJS: `dist/esm`, `dist/cjs`, types in `dist/types`. Build with
  `pnpm --filter @commitonce/solana build` (two `tsc` passes, no bundler).
* Entry point: the single root export (`packages/sdk/src/index.ts`). There are no
  subpath exports.

Every symbol below is exported from the package root and was checked against the built
artifact.

### 9.1 Constants

| Export | Type | Value |
| --- | --- | --- |
| `COMMIT_ONCE_PROGRAM_ADDRESS` | `Address` | `CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB` |
| `SYSTEM_PROGRAM_ADDRESS` | `Address` | `11111111111111111111111111111111` |
| `INSTRUCTIONS_SYSVAR_ADDRESS` | `Address` | `Sysvar1nstructions1111111111111111111111111` |
| `RECEIPT_SEED` | `Uint8Array` | UTF-8 of `commit-once` (11 bytes) |
| `RECEIPT_VERSION` | `number` | `1` |
| `PERMANENT_RETENTION` | `bigint` | `0n` |
| `MIN_RETENTION_SECONDS` | `bigint` | `3_600n` |
| `MAX_RETENTION_SECONDS` | `bigint` | `31_536_000n` |
| `SLOTS_PER_SECOND` | `bigint` | `4n` |
| `RECEIPT_ACCOUNT_SIZE` | `number` | `202` |
| `ACCOUNT_STORAGE_OVERHEAD` | `bigint` | `128n` |
| `MAINNET_LAMPORTS_PER_BYTE` | `bigint` | `5_080n` |
| `RECEIPT_RENT_LAMPORTS` | `bigint` | `1_676_400n` — `(202n + 128n) × 5080n` |
| `NAMESPACE_DOMAIN` | `string` | `commitonce/namespace/v1` |
| `IDEMPOTENCY_KEY_DOMAIN` | `string` | `commitonce/key/v1` |
| `CLAIM_DISCRIMINATOR` | `Uint8Array` (8) | `3ec6d6c1d59f6cd2` |
| `CLOSE_RECEIPT_DISCRIMINATOR` | `Uint8Array` (8) | `7efef4cb7ca48659` |
| `INTENT_RECEIPT_DISCRIMINATOR` | `Uint8Array` (8) | `54fc5d647e500f86` |

```ts
import { RECEIPT_RENT_LAMPORTS, COMMIT_ONCE_PROGRAM_ADDRESS } from '@commitonce/solana';

console.log(RECEIPT_RENT_LAMPORTS); // 1676400n
console.log(COMMIT_ONCE_PROGRAM_ADDRESS); // CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB
```

### 9.2 Hashing and canonical intent encoding

#### `sha256(data: ByteSequence): Promise<Uint8Array>`

SHA-256 over raw bytes. `ByteSequence` is `Iterable<number> & { length: number }`, so both
`Uint8Array` and `@solana/kit`'s `ReadonlyUint8Array` are accepted.

```ts
await sha256(new TextEncoder().encode('increment'));
// Uint8Array(32) f6792302…8bc9
```

#### `getSubtleCrypto(): SubtleCrypto`

Returns `globalThis.crypto.subtle`, or throws an error naming the problem. Needed in a
browser, where WebCrypto requires a secure context (https or localhost). Callers who cannot
enable it must hash with their own SHA-256 and use the low-level API
(`deriveReceiptAddress` plus `encodeClaimData`).

#### `namespaceHash(namespace: string): Promise<Uint8Array>`

`sha256("commitonce/namespace/v1" ‖ utf8(namespace))`. The domain separator is concatenated
with no delimiter; the empty string is a legal namespace.

```ts
await namespaceHash('payments:transfer');
// 9e7bb3a4dce399c675e567cec2312197966a9dd8ab00b93834b82ead8a49cde3
```

#### `idempotencyKeyHash(idempotencyKey: string): Promise<Uint8Array>`

`sha256("commitonce/key/v1" ‖ utf8(key))`.

```ts
await idempotencyKeyHash('order_928');
// 0a9ba9a57e3b998c5807159e02e362f2d14c85cfe02e5b508e7f2cfd2d3d4e0d
```

#### `encodeIntent(intent: CanonicalIntent): Uint8Array`

Deterministic, injective, length-prefixed encoding. Every token is `<tag><length>:<payload>`:

| Value | Encoding |
| --- | --- |
| `null` | `z` |
| `false` / `true` | `f` / `t` |
| number | `d<len>:<decimal>` (finite only) |
| bigint | `i<len>:<decimal>` |
| string | `s<byteLen>:<utf8>` |
| bytes (`Uint8Array`) | `b<byteLen>:<raw>` |
| array | `a<count>:` then each element |
| object | `o<count>:` then each `key`,`value` pair |

Object keys are sorted by UTF-16 code unit, so insertion order cannot change the result.
`undefined`, non-finite numbers, `Date`, `Map` and `Set` all throw rather than being
silently coerced or dropped. `-0` and `0` encode identically (matching
`String(-0) === '0'`). Floating-point numbers are not decimal-exact — pass amounts as
`bigint` or decimal strings.

```ts
new TextDecoder().decode(encodeIntent({ to: 'alice', memo: 'order', amount: 100n }));
// 'o3:s6:amounti3:100s4:memos5:orders2:tos5:alice'
```

#### `hashIntent(intent: CanonicalIntent): Promise<Uint8Array>`

`sha256(encodeIntent(intent))` — the 32-byte payload fingerprint stored on chain.

```ts
await hashIntent({ to: 'alice', amount: 10_000_000n });
```

#### `toPayloadHash(intent: CanonicalIntent | Uint8Array): Promise<Uint8Array>`

Normalises the `intent` argument accepted by the high-level API. A 32-byte `Uint8Array` is
taken as an already-computed fingerprint and returned as-is; anything else is canonically
encoded and hashed. A `Uint8Array` of any other length throws a `RangeError`. To fingerprint
raw bytes as *content*, wrap them: `{ data: bytes }`.

```ts
await toPayloadHash(precomputed32Bytes); // returned unchanged
await toPayloadHash({ data: someBytes }); // hashed as content
```

#### `bytesToHex(bytes: ByteSequence): string` / `hexToBytes(hex: string): Uint8Array`

Lowercase hex output; the parser accepts an optional `0x` prefix and either case, and throws
`RangeError` on odd length or invalid digits.

```ts
bytesToHex(new Uint8Array([0, 1, 127, 128, 255])); // '00017f80ff'
hexToBytes('0x00017F80FF'); // Uint8Array [0, 1, 127, 128, 255]
```

#### Types

```ts
type ByteSequence = Iterable<number> & { readonly length: number };

type CanonicalIntent =
    | null
    | boolean
    | string
    | number
    | bigint
    | Uint8Array
    | readonly CanonicalIntent[]
    | { readonly [key: string]: CanonicalIntent };
```

### 9.3 PDA derivation

#### `deriveReceiptAddress(args: DeriveReceiptAddressArgs): Promise<readonly [Address, number]>`

Derives `[address, bump]` from `[b"commit-once", authority, namespace_hash, idempotency_key_hash]`
under the program address. Both hashes must be 32-byte `Uint8Array`s or a `RangeError` is
thrown — the function refuses to derive a wrong address from malformed input.

```ts
type DeriveReceiptAddressArgs = {
    readonly authority: Address;
    readonly namespaceHash: Uint8Array;      // 32 bytes
    readonly idempotencyKeyHash: Uint8Array; // 32 bytes
    readonly programAddress?: Address;       // defaults to the canonical deployment
};
```

```ts
const [receipt, bump] = await deriveReceiptAddress({
    authority,
    namespaceHash: await namespaceHash('payments:transfer'),
    idempotencyKeyHash: await idempotencyKeyHash('order_928'),
});
```

The bump is the canonical one found by the runtime. The program re-derives it through its
`seeds`/`bump` constraint, so a wrong bump cannot reach a different account.

### 9.4 Instruction construction

#### `prepareIntent(args: PrepareIntentArgs): Promise<PreparedIntent>`

The primary integration point. **Pure**: everything is derived locally with WebCrypto, so no
RPC, prover or indexer is involved, and it is usable in a wallet, a relayer or an offline
signer. It validates the retention range and rejects a `refundDestination` equal to the
receipt PDA locally, so obvious mistakes fail before a transaction is built.

```ts
type PrepareIntentArgs = {
    readonly authority: Address;
    readonly namespace: string;
    readonly idempotencyKey: string;
    readonly intent: CanonicalIntent | Uint8Array;
    readonly retention?: Retention;            // defaults to 24 hours
    readonly refundDestination?: Address;      // defaults to the authority
    readonly programAddress?: Address;         // defaults to the canonical deployment
};

type PreparedIntent = {
    readonly instruction: Instruction;         // prepend this to your business instructions
    readonly receipt: Address;
    readonly receiptBump: number;
    readonly namespaceHash: Uint8Array;
    readonly idempotencyKeyHash: Uint8Array;
    readonly payloadHash: Uint8Array;
    readonly retentionSeconds: bigint;
    readonly refundDestination: Address;
    readonly programAddress: Address;
};
```

```ts
const guard = await prepareIntent({
    authority,
    namespace: 'payments:transfer',
    idempotencyKey: 'order_928',
    intent: { to: 'alice', mint: 'USDC', amount: 10_000_000n },
    retention: '24h',
});

// The instruction's accounts, in order:
//   [authority: WRITABLE_SIGNER, receipt: WRITABLE,
//    Sysvar1nstructions…: READONLY, 11111111111111111111111111111111: READONLY]
// and its data is 144 bytes.
```

`Retention` is:

```ts
type Retention =
    | 'permanent'          // never expires, never closable
    | number               // whole seconds
    | bigint               // seconds
    | `${number}s` | `${number}m` | `${number}h` | `${number}d`;
```

#### `parseRetention(retention: Retention | undefined): bigint`

Converts a `Retention` to seconds. `undefined` yields `DEFAULT_RETENTION_SECONDS`
(86,400n). Throws `RangeError` on malformed input — a fractional number, an unparseable
string, or a bad unit — rather than coercing, because a silently wrong retention silently
changes the security window.

```ts
parseRetention(undefined); // 86400n
parseRetention('permanent'); // 0n
parseRetention('30m'); // 1800n
parseRetention('24h'); // 86400n
parseRetention('30d'); // 2592000n
```

#### `assertValidRetention(retentionSeconds: bigint): void`

Throws `RangeError` unless the value is `0n` or within `[MIN_RETENTION_SECONDS,
MAX_RETENTION_SECONDS]`. This is a convenience, not a security boundary: the program
enforces the same range on chain.

```ts
assertValidRetention(3_600n);  // ok
assertValidRetention(3_599n);  // throws
```

#### `DEFAULT_RETENTION_SECONDS`

`86_400n` — 24 hours, used when `retention` is omitted.

#### `encodeClaimData(args: EncodeClaimDataArgs): Uint8Array`

Borsh-encodes the 144-byte `claim` data. Exported so callers who supply precomputed hashes
(§9.2, `getSubtleCrypto`) can still build the instruction.

```ts
type EncodeClaimDataArgs = {
    readonly namespaceHash: Uint8Array;
    readonly idempotencyKeyHash: Uint8Array;
    readonly payloadHash: Uint8Array;
    readonly retentionSeconds: bigint;
    readonly refundDestination: Address;
};
```

#### `CLAIM_DATA_LENGTH`

`144` — the serialized length of `claim` data.

#### `createCloseReceiptInstruction(args: CloseReceiptInstructionArgs): Instruction`

Builds the `close_receipt` instruction: two writable accounts (`receipt`,
`refundDestination`) and 8 bytes of data. Anyone may submit it once a receipt has expired,
and the deposit returns to the destination recorded at claim time.

```ts
type CloseReceiptInstructionArgs = {
    readonly receipt: Address;
    readonly refundDestination: Address;  // must equal the value recorded at claim time
    readonly programAddress?: Address;
};
```

```ts
const close = createCloseReceiptInstruction({ receipt, refundDestination: authority });
```

### 9.5 Receipt decoding

#### `decodeIntentReceipt(data: Uint8Array): IntentReceiptAccount`

Decodes the 202-byte account. Throws `ReceiptDecodeError` if the discriminator is missing or
the length is not exactly 202 — it never returns partial data, so a caller cannot act on a
misparsed receipt.

```ts
type IntentReceiptAccount = {
    readonly version: number;
    readonly bump: number;
    readonly authority: Address;
    readonly namespaceHash: Uint8Array;
    readonly idempotencyKeyHash: Uint8Array;
    readonly payloadHash: Uint8Array;
    readonly refundDestination: Address;
    readonly createdSlot: bigint;
    readonly expiresAtSlot: bigint;          // 0 = permanent
    readonly createdUnixTimestamp: bigint;
    readonly expiresAtUnixTimestamp: bigint; // 0 = permanent
};
```

```ts
const receipt = decodeIntentReceipt(accountData);
console.log(receipt.createdSlot, receipt.expiresAtSlot);
```

#### `isIntentReceipt(data: Uint8Array): boolean`

`true` if `data` starts with the `IntentReceipt` discriminator. A cheap check that does not
throw; it does not validate the length.

#### `isPermanentReceipt(receipt: IntentReceiptAccount): boolean`

`true` when `expiresAtSlot === 0n`, i.e. retention was `0`. Such a receipt can never be
closed.

#### `isSupportedVersion(receipt: IntentReceiptAccount): boolean`

`true` when `version === RECEIPT_VERSION` (`1`). `false` means the receipt was written by an
incompatible program version.

#### `isClosable(receipt, clock): boolean`

`clock` is `{ slot: bigint; unixTimestamp: bigint }`. Returns `false` for a permanent
receipt, and otherwise `clock.slot >= expiresAtSlot && clock.unixTimestamp >=
expiresAtUnixTimestamp` — mirroring the program exactly, including the requirement that
**both** gates pass.

```ts
isClosable(receipt, { slot: 5_000n, unixTimestamp: 1_700_000_000n }); // false: slot gate only
```

#### `ReceiptDecodeError`

`Error` subclass raised by `decodeIntentReceipt`. `name` is `'ReceiptDecodeError'`.

### 9.6 Error classification

#### `classifyError(error: unknown): CommitOnceErrorKind`

Never throws. Walks the object graph for the two shapes RPC clients produce —
`{ InstructionError: [index, { Custom: 6000 }] }`, possibly nested under `context.err` or
`err` — and also parses error *messages* such as `custom program error: 0x1770` or
`custom program error: 6000`, because clients routinely surface the program error only in a
message string. An unrecognised error is reported as `{ kind: 'other', code: null }` rather
than guessed at.

```ts
type CommitOnceErrorKind =
    | { readonly kind: 'commit-once'; readonly name: CommitOnceErrorName;
        readonly code: number; readonly message: string }
    | { readonly kind: 'other'; readonly code: number | null };
```

```ts
const classified = classifyError(rpcError);
if (classified.kind === 'commit-once') {
    console.log(classified.name, classified.code, classified.message);
}
```

#### `isAlreadyCommitted(error: unknown): boolean`

`true` when the error means "this intent already committed, and the guarded instructions
were therefore skipped". This is the **expected, non-exceptional outcome of a retry** — the
single most important branch in a guarded retry loop.

#### `isIdempotencyConflict(error: unknown): boolean`

`true` when the key was reused with a different payload fingerprint. Never retry this; it
means a bug or a genuinely different action sharing a key.

#### `COMMIT_ONCE_ERROR_CODES`

`Record<CommitOnceErrorName, number>` — `AlreadyCommitted: 6000` … `ReceiptIsPermanent: 6010`
(see §7).

#### `COMMIT_ONCE_ERROR_MESSAGES`

`Record<CommitOnceErrorName, string>` — the same eleven names mapped to SDK-authored
human-readable guidance, for CLI and UI output. These are the SDK's wording, which is
deliberately more instructive than the on-chain message (for example `AlreadyCommitted`
explains that the transaction was aborted so the guarded instructions did not run again).

#### Types

```ts
type CommitOnceErrorName = keyof typeof COMMIT_ONCE_ERROR_CODES; // 11 names
```

### 9.7 RPC client

#### `createCommitOnceClient(config: CommitOnceClientConfig): CommitOnceClient`

Binds the pure instruction builders to an RPC endpoint and a program address. The read side
needs only three RPC methods, which is stated explicitly in the type:

```ts
type CommitOnceRpc = Rpc<GetAccountInfoApi & GetSlotApi & GetBlockTimeApi>;

type CommitOnceClientConfig = {
    readonly rpc: CommitOnceRpc;            // a full createSolanaRpc(...) client satisfies this
    readonly programAddress?: Address;      // defaults to the canonical deployment
};
```

| Member | Signature | Notes |
| --- | --- | --- |
| `programAddress` | `Address` | The address the client was bound to. |
| `rpc` | `CommitOnceRpc` | The RPC surface. |
| `prepare` | `(args: Omit<PrepareIntentArgs, 'programAddress'>) => Promise<PreparedIntent>` | Pure; identical to `prepareIntent` with the client's program address filled in. |
| `deriveReceipt` | `(args: { authority: Address; namespace: string; idempotencyKey: string }) => Promise<readonly [Address, number]>` | Hashes and derives without touching the network. |
| `fetchReceipt` | `(receipt: Address) => Promise<IntentReceiptAccount \| null>` | One `getAccountInfo`. Returns `null` if the account does not exist. Throws if an account exists there but is **not** owned by the CommitOnce program, rather than interpreting foreign data as a receipt. |
| `inspect` | `(args: InspectIntentArgs) => Promise<IntentStatus>` | Answers "what does the chain currently say about this intent?" |
| `fetchClock` | `() => Promise<CommitOnceClock>` | `getSlot` (confirmed) then `getBlockTime`. Throws if the cluster reports no block time for that slot, because expiry cannot be evaluated without it. |
| `closeReceiptInstruction` | `(args: Omit<CloseReceiptInstructionArgs, 'programAddress'>) => Instruction` | Builds the cleanup instruction. |

```ts
type CommitOnceClock = { readonly slot: bigint; readonly unixTimestamp: bigint };

type InspectIntentArgs = {
    readonly authority: Address;
    readonly namespace: string;
    readonly idempotencyKey: string;
    readonly intent?: CanonicalIntent | Uint8Array;  // enables `matchesIntent`
    readonly clock?: CommitOnceClock;                // enables `closable` and the expired/committed split
    readonly programAddress?: Address;
};

type IntentStatus =
    | { readonly status: 'unclaimed'; readonly receipt: Address }
    | ({ readonly status: 'committed' } & ReceiptSummary)
    | ({ readonly status: 'expired' } & ReceiptSummary);

type ReceiptSummary = {
    readonly receipt: Address;
    readonly receiptData: IntentReceiptAccount;
    readonly permanent: boolean;
    readonly closable: boolean | null;      // null when no clock was supplied
    readonly matchesIntent: boolean | null; // null when no intent was supplied
    readonly supportedVersion: boolean;
};
```

`matchesIntent` is the field that distinguishes a duplicate from a conflict *before* you
send anything: `true` means a retry would be blocked as a duplicate (the desired outcome),
`false` means the key was already used for something else and you are about to get
`IdempotencyConflict`. `status: 'expired'` means a receipt exists, both deadlines have
passed and it may be closed — note that the guard still blocks until it *is* closed.

```ts
const commitOnce = createCommitOnceClient({ rpc: createSolanaRpc(devnet('https://api.devnet.solana.com')) });

const status = await commitOnce.inspect({
    authority,
    namespace: 'payments:transfer',
    idempotencyKey: 'order_928',
    intent: { to: 'alice', mint: 'USDC', amount: 10_000_000n },
    clock: await commitOnce.fetchClock(),
});

if (status.status === 'committed' && status.matchesIntent === true) {
    // already done — do not send
}
```

---

## 10. Verifying the implementation yourself

```bash
# TypeScript side: 48 tests, including the cross-language vectors.
pnpm --filter @commitonce/solana test

# Print the pinned vectors, recomputed from @solana/kit primitives without importing the SDK.
node packages/sdk/scripts/print-vectors.mjs

# Rust side: builds both programs, verifies program IDs against deploy-keys/.
bash scripts/build.sh

# Rust side: the whole suite, against the real compiled SBF artifact in LiteSVM.
bash scripts/test.sh

# One file, with output visible:
bash scripts/test.sh --test invariant -- --nocapture
bash scripts/test.sh --test security -- --nocapture
bash scripts/test.sh --test retention -- --nocapture
bash scripts/test.sh --test wire_format -- --nocapture

# Measured overhead (compute units, wire size, deposit). No figure in this document is
# quoted from it — read the numbers from the run.
bash scripts/test.sh --test benchmarks -- --nocapture
```

The Rust suite executes the compiled `.so` through LiteSVM, not a mock. `scripts/test.sh`
locates the artifacts through `COMMIT_ONCE_DEPLOY_DIR`, defaulting to
`$CARGO_TARGET_DIR/deploy`; the test harness itself falls back to `<repo>/target/deploy`.
Both scripts assume a Linux/WSL toolchain (they set `HOME` and `PATH` for a specific
machine), so set `CARGO_TARGET_DIR` and `COMMIT_ONCE_DEPLOY_DIR` explicitly on your own.

---

## 11. Pinned cross-language vectors

These values are asserted independently by `programs/commit-once/tests/wire_format.rs` and
`packages/sdk/test/vectors.test.ts`, and recomputed a third time by
`packages/sdk/scripts/print-vectors.mjs` without importing the SDK. If the program and the
SDK ever drift, at least one of those fails.

| Input | Value |
| --- | --- |
| `sha256("global:claim")[0..8]` | `3ec6d6c1d59f6cd2` |
| `sha256("global:close_receipt")[0..8]` | `7efef4cb7ca48659` |
| `sha256("account:IntentReceipt")[0..8]` | `54fc5d647e500f86` |
| `namespaceHash("demo:counter")` | `7b2ba4a847222b78b1655df2392e89a615434dd1cff70554e59a8b80d3258ddf` |
| `namespaceHash("payments:transfer")` | `9e7bb3a4dce399c675e567cec2312197966a9dd8ab00b93834b82ead8a49cde3` |
| `idempotencyKeyHash("order_928")` | `0a9ba9a57e3b998c5807159e02e362f2d14c85cfe02e5b508e7f2cfd2d3d4e0d` |
| `idempotencyKeyHash("order_1")` | `388806aee4466141bbdfd00b3d65f34cf840ec6b5edd4bdd9687ce73b1aee278` |
| `sha256("increment")` | `f679230253e596b02442b1ca20083da5efd7bf5dfe48a9814afb6fe8ebe58bc9` |
| `sha256("payload")` | `239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5` |

Receipt PDAs for a fixed authority (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`), used to
pin the derivation across languages:

| Namespace | Key | Receipt PDA | Bump |
| --- | --- | --- | --- |
| `demo:counter` | `order_928` | `7vMcWBtiMjeFgpx96E5ZtVZoYeRLn5Fu57RcTtzJeh9J` | 254 |
| `payments:transfer` | `order_928` | `654vyv9LHwgAgn2rceouNQj8GXwiatAseFZAKCPPSTYV` | 255 |
| `app_a:swap` | `order_928` | `4MiJeybibL5QoA6m8Q8duUuzWnoumZxLPj32G3DHTbFG` | 255 |

---

## 12. Documented gaps

Things a reader might reasonably expect to find here, which the source does not define:

* **No TypeScript type for the program's IDL.** The SDK hand-encodes the instruction data
  and does not consume `target/types/commit_once.ts`. The IDL exists
  (`target/idl/commit_once.json`) and is generated by `anchor build`, but nothing in the
  SDK imports it.
* **No `createClaimInstruction` helper.** There is no single function that turns a prepared
  intent into an `Instruction`; `prepareIntent` returns a `PreparedIntent` whose `instruction`
  field already holds one, and the lower-level path is `encodeClaimData` plus a hand-built
  `Instruction`. (An earlier revision of `getSubtleCrypto`'s error message named a
  `createClaimInstruction` that does not exist. That message now names `encodeClaimData` and
  `deriveReceiptAddress`, which do.)
* **No explicit decode/encode for the receipt account's event payloads.** The two events are
  described in the IDL and emitted on chain, but the SDK exports no decoders for them.
* **No `retention` value in the receipt beyond the two deadlines.** The original
  `retention_seconds` is not stored; derive it from `expires_at_unix_ts − created_unix_ts`.
* **No framework-level error codes enumerated.** Anchor constraint failures (seeds, address,
  signer, account ownership, discriminator) are outside the 6000 range and are not mapped by
  `classifyError`; they surface as `{ kind: 'other', code }` or `{ kind: 'other', code: null }`.
