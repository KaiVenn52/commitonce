# CommitOnce

**Idempotency keys for Solana.**

> Retry without executing twice.

An onchain idempotency layer for Solana actions. Prepend one instruction to the transaction
you already build, and a *rebuilt* retry can no longer execute the same logical intent a
second time.

```
   ┌──────────────────────────────────────────────────────────────────┐
   │  one atomic Solana transaction                                   │
   ├──────────────────────────────────────────────────────────────────┤
   │  1. commit_once::claim(namespace, key, payload, retention)       │
   │       receipt absent  → create it, continue                      │
   │       receipt present → ERROR → whole transaction reverts        │
   │  2. …your existing business instructions…                        │
   └──────────────────────────────────────────────────────────────────┘
```

---

## The problem

Solana's runtime deduplicates transactions by **message hash**. Agave's own source says so:

> *"add the message hash to the status cache to ensure that this message won't be processed
> again with a different signature"*

That protects *signed bytes*. It does not protect a *logical intent*.

Your client submits a payment. The response times out. The client cannot tell whether the
transaction landed. So it rebuilds — fresh blockhash, a higher priority fee because the
first attempt was slow, maybe a different route, re-signed. **The message hash is now
different, so the runtime sees a brand new transaction. Both can land.**

This is not a corner case. Solana's official production-readiness guidance names it and then
hands the problem back to the application:

> *"A rebuilt transaction has a new signature, so preserve application-level idempotency
> before sending it."*
> — <https://solana.com/docs/tools/production-readiness>

The same page warns that *"a `null` result from the recent signature-status cache is
inconclusive"* — so even checking whether the first attempt landed is not reliable. Every
transaction-delivery vendor repeats the handoff. Helius documents that `sendTransaction`
*"does not alter the transaction in any way"* and warns that re-signing *"can lead to
duplicate transactions being confirmed"*. Triton tells clients to *"handle retries in your
own code."*

The layer that would let the chain itself answer *"has this intent already happened?"* does
not exist as a product. **CommitOnce is that layer.**

---

## The guarantee, stated exactly

> For one `(authority, namespace, idempotency key)` tuple, **no more than one guarded
> transaction may successfully commit during the receipt retention period.**

This is **at-most-once successful execution within a retention window**. Combined with
ordinary retry-until-success it gives exactly-once-style application semantics. It is *not*
a claim of universal exactly-once execution, and this repository does not describe it as
one anywhere.

Two properties fall out of putting the guard in the *same atomic transaction* as the
business instructions:

- **A receipt cannot exist without its action having committed.** If a later instruction
  fails, the receipt creation rolls back too, so a failed attempt stays retryable instead of
  being permanently poisoned.
- **A blocked duplicate cannot partially execute.** When `claim` errors, the transaction
  fails and the business instructions after it never run.

Both are asserted by tests, not just described in prose.

---

## Quickstart

```bash
pnpm install
bash scripts/build.sh     # builds both programs with the Solana toolchain
bash scripts/test.sh      # runs the full suite against the compiled SBF artifact
```

Use it from an application:

```ts
import { createCommitOnceClient, encodeIntent } from '@commitonce/solana';

const commitOnce = createCommitOnceClient({ rpc });

// The fingerprint covers what the intent *is* — never how it was transported.
// Including a blockhash, priority fee or signature here would defeat the product.
const intent = {
  namespace: 'payments',
  key: 'order-928',
  payload: { recipient, amount, mint, memo: 'invoice-928' },
};

const claim = await commitOnce.prepare(intent);

// Prepend to the transaction you were already building. Same atomic transaction.
const transaction = [claim.instruction, ...yourBusinessInstructions];
```

On a rebuilt retry, reuse the **same** `key`. The receipt already exists, so `claim` fails,
the transaction reverts, and your action runs once. See
[`docs/QUICKSTART.md`](docs/QUICKSTART.md) and
[`docs/INTEGRATION_PLAYBOOK.md`](docs/INTEGRATION_PLAYBOOK.md).

---

## Measured overhead

Every figure below comes from executing the real compiled program, not from estimation.
Reproduce with `bash scripts/test.sh --test benchmarks -- --nocapture`.

**The structural cost is exact. The compute-unit cost is not.** Compute units vary from run to
run on both the real cluster and in the in-process test harness, so they are given as ranges
and the highest figure is the one to budget against. The byte and account counts are
deterministic and are the numbers that actually determine the wire cost and the deposit.

| | Business action alone | With the guard | Delta |
| --- | --- | --- | --- |
| Transaction size (legacy) — exact | 273 bytes | 677 bytes | **+404 bytes** |
| Accounts — exact | 3 | 7 | **+4** |
| Compute units — observed range | 4,067 – 10,067 | 12,404 – 22,904 | **+8,337 – +12,837** |

| Compute units, per operation | Observed on devnet | In-process harness (median) |
| --- | --- | --- |
| `claim` alone | 14,669 | 9,283 |
| `claim` blocked as a duplicate | 13,977 | 8,053 |
| `close_receipt` (cleanup) | not measured | 2,701 (no variance observed) |
| Business action alone | 4,067 / 7,067 | 5,567 |

| Receipt account — exact | |
| --- | --- |
| Data length | 202 bytes |
| Rent deposit | 1,676,400 lamports (0.0016764 SOL) |
| `claim` instruction data | 144 bytes |
| `claim` accounts | 4 |

**Reading these honestly.**

*The structural cost is the solid claim.* +404 bytes is 128 bytes of account keys plus a
276-byte instruction. +4 accounts are the receipt PDA, the Instructions sysvar, the System
program and the CommitOnce program id — the System program is usually already present, so in
practice it is usually +3. That is the whole cost, and it is exact.

*The compute cost is the weaker claim, so it is stated as a range.* The same unmodified test
binary, running the same byte-identical `.so`, has reported a bare counter increment anywhere
from 4,067 to 10,067 CU and the guard delta from 8,337 to 12,837. On devnet the `claim`
instruction consumed 14,669 CU when it succeeded and 13,977 CU when it rejected a duplicate —
higher than the in-process harness reports, which is one more reason to trust the cluster over
the harness. **Budget ~23,000 CU for a guarded transaction**, which is about 11% of the
200,000 CU default budget and well under the 400,000 CU limit the demo transactions were
granted. The *relative* cost falls as the guarded action grows, because this baseline is a
trivial counter increment.

*The deposit is not a cost.* It is fully refunded by `close_receipt`; only the cleanup
transaction fee is spent. The rent rate is mainnet's 5080 lamports/byte since SIMD-0437 step 2.
Note that the `solana-rent` Rust crate still ships a stale 6960 lamports/byte, so any estimate
derived from it is 37% too high — the test harness overrides the sysvar to the real value.

Because compute units are not reproducible, the benchmark asserts only the exact structural
numbers and the ordering that must hold (`guarded > bare`). Asserting a specific compute-unit
value would make the suite flaky and would assert something that is not a property of the
program.

---

## How it works

The receipt is a plain program-owned PDA whose address *is* the intent's identity:

```text
receipt PDA = find_program_address(
    seeds = [
        b"commit-once",        // 11 bytes — domain prefix
        authority,             // 32 bytes — the signer
        namespace_hash,        // 32 bytes — sha256("commitonce/namespace/v1" ‖ namespace)
        idempotency_key_hash,  // 32 bytes — sha256("commitonce/key/v1" ‖ key)
    ],
    program_id = CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB,
)
```

"Has this intent already committed?" is therefore answered by *whether an account exists* —
a check that is atomic with the action it guards and that no amount of rebuilding can
bypass, because it lives in chain state rather than in signed bytes.

Four design decisions carry most of the weight:

**The authority is in the seeds.** A third party who learns your namespace and key derives a
*different* address. They cannot consume your key and cannot block your intent. This is
enforced by the program's `seeds` constraint rather than left to callers to remember — which
matters, because an un-scoped "have I done this already?" guard is a griefing vector:
whoever guesses an id first can permanently block it.

**Hashes are derived client-side.** Fixed-size instruction data, unbounded strings kept out
of PDA seeds, and a derivation pinned to golden hex vectors in *two* languages (Rust and
TypeScript). `packages/sdk/scripts/print-vectors.mjs` recomputes the same values from
`@solana/kit` primitives without importing the SDK, so the two suites cannot agree by
construction.

**The payload fingerprint distinguishes "same intent" from "same key, different intent".**
Reusing a key with a different fingerprint is reported as `IdempotencyConflict` rather than
silently returning the first result. The fingerprint covers semantic fields only — recipient,
amount, mint, memo, order id — and never blockhash, signature, priority fee, retry count or
submission route, because including any of those would make a retry look like a new intent
and defeat the entire product.

**Retention is explicit and bounded.** `0` means permanent. Otherwise the range is one hour
to 365 days. `close_receipt` refunds the deposit and requires **both** the monotonic slot
deadline and the wall-clock deadline to have passed, so a change in slot timing can only
ever *delay* cleanup — never accelerate it into a window where a still-valid signed
duplicate could execute. Cleanup is permissionless but cannot steal: the program constrains
the destination to the `refund_destination` recorded at claim time.

A durable-nonce transaction never expires, so an old signed duplicate stays executable
forever. Combining one with a cleanable receipt would reopen the duplicate window, so
`claim` detects a System Program `AdvanceNonceAccount` in the Instructions sysvar and
refuses unless the retention is permanent.

Full detail, including the account-by-account and byte-by-byte layouts, is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Verification

```bash
bash verify.sh          # everything: 12 steps, PASS/FAIL summary, true exit code
bash scripts/build.sh   # builds, then verifies declare_id! against deploy-keys/
bash scripts/test.sh    # 46 tests, exit code 0
```

`verify.sh` is the one to run. It checks prerequisites, builds both programs, verifies
`declare_id!` against the committed keypairs, runs the Rust suite and the benchmarks, then
typechecks, builds, tests and dual-imports the SDK, typechecks the demo and all four examples,
checks the brand assets against the site palette, and checks the documentation for broken links,
unreadable evidence logs, impossible test counts and corrected claims that have crept back. It
fails loudly rather than silently skipping a step, and a step that could not run counts as a
failure, not a pass. Last full run: **`RESULT: PASS (12 steps ran and passed)`**.

The tests execute the **real compiled SBF artifact** through LiteSVM — not a mock, not a
reimplementation. They assert on observable onchain state: counter values, account
existence, lamport balances, PDA addresses. No test asserts on an error message string.

| Suite | Tests | Covers |
| --- | --- | --- |
| `invariant.rs` | 11 | the core guarantee, atomic rollback, scoping, same-slot races, guard transparency |
| `retention.rs` | 9 | expiry gates, rent refund, permissionless cleanup, boundary values |
| `security.rs` | 10 | griefing, receipt substitution, malformed state, durable-nonce policy |
| `wire_format.rs` | 10 | discriminator and layout pinning, golden hash vectors, rent rate |
| `benchmarks.rs` | 1 | the overhead table above |

The load-bearing one, in outline:

```rust
// Two genuinely rebuilt transactions — fresh blockhash, different priority fee —
// so the runtime's message-hash dedup cannot help.
let attempt_1 = env.send_distinct(&[claim, increment], 1);
let attempt_2 = env.send_distinct(&[claim, increment], 2);

assert_success(&attempt_1);
assert_custom_error(&attempt_2, E_ALREADY_COMMITTED);
assert_eq!(env.counter_value(&authority), 1);   // ran exactly once
```

The same scenario *without* the guard is a test too
(`without_guard_two_rebuilt_transactions_execute_twice`), and it demonstrates the bug: the
counter reaches 2.

### The same thing, on devnet

[`apps/demo/`](apps/demo/) runs that A/B against the deployed devnet programs and prints
explorer links. It was executed on **2026-09-21**; the raw output is kept at
[`submission/evidence/devnet-demo-run.log`](submission/evidence/devnet-demo-run.log) and the
signatures are listed in [`EVIDENCE.md`](EVIDENCE.md).

```bash
PAYER_KEYPAIR=~/.config/solana/id.json node apps/demo/commitonce-demo.ts
```

```
  scenario          counter onchain  expected  result
  A  without-guard  2                2         PASS
  B  with-guard     1                1         PASS
```

The retry in scenario B did not fail for some unrelated reason: it failed with
`AlreadyCommitted`, and the guarded increment never ran a second time.

### Many claims of one key, at once

The A/B above rebuilds one intent twice. [`apps/demo/concurrent-claim.ts`](apps/demo/concurrent-claim.ts)
is the harder case: it puts **one idempotency key into several transactions at once and fires
them at real devnet validators**. Each attempt is a genuinely distinct signed transaction (a
different priority fee, so the runtime's message-hash deduplication cannot connect them), and
they are all built against one blockhash, so they target the same slot.

```bash
PAYER_KEYPAIR=~/.config/solana/id.json node apps/demo/concurrent-claim.ts --attempts 5
```

```
  #  priority fee  slot       outcome  error
  0  1000          501956389  SUCCESS  succeeded
  1  8000          501956391  FAILED   instruction 1 failed with custom program error 6000
  2  15000         501956391  FAILED   instruction 1 failed with custom program error 6000
  3  22000         501956391  FAILED   instruction 1 failed with custom program error 6000
  4  29000         501956391  FAILED   instruction 1 failed with custom program error 6000

  counter before 0   counter after 1   business action executions 1
```

Exactly one of five committed; the rest were rejected **onchain**, not in simulation. Raw output:
[`submission/evidence/devnet-contention-run.log`](submission/evidence/devnet-contention-run.log).

One caveat, stated rather than buried: those five attempts landed in **two** slots. A slot's
leader decides what to pack and a client cannot force two transactions into one slot, so this
proves contention on a live cluster — the **same-slot** case is proven in-process by
`only_the_first_of_many_attempts_commits`. Both are real; they are not the same experiment.

---

## Prior art

This section exists because the honest answer matters more than a clean story, and because a
judge or investor will find these anyway.

**The problem is officially acknowledged.** Solana's production-readiness guide tells
developers to preserve application-level idempotency across rebuilds. Squads' `nonce-guard`
program inspects the Instructions sysvar to detect durable-nonce transactions — the same
introspection technique used here. Anchor's `init` idiom (create-or-fail on an existing
account) is the same primitive at a smaller scale, and `p-never-nonce` and
`solana-asm/shield` ship the "prepend a tiny generic guard program" *UX shape*.
Helium's `lazy_transactions` genuinely implements at-most-once execution that survives
rebuilds, but requires instructions to be pre-committed into an authority-owned Merkle tree
keyed by a `u32` leaf index, so it is application-specific rather than generic. The
Stripe-style `Idempotency-Key` pattern is the closest conceptual relative, and SDP's
specification includes `transactionId` in its fingerprint — a primary-source admission that
HTTP idempotency keys do not solve rebuilt transactions.

**The closest product is Light Protocol's `nullifier-program`**
(`NFLx5WGPrTHHvdRNsidcrNcLxRruMC92E4yv7zhZBoT`), which is real, live on mainnet and devnet,
permissionless, generic, and describes itself in much the same terms. It is **not materially
equivalent**, for five concrete reasons:

| | Light `nullifier-program` | CommitOnce |
| --- | --- | --- |
| Seeds | `["nullifier", id]` — **no signer** | authority-scoped, enforced by `seeds` |
| Griefing | anyone who guesses an id can claim and block it | a third party derives a *different* address |
| Dependencies | requires an RPC/prover (`create_nullifier_ix(rpc, …)`, `fetch_proof`) | self-contained; derivation is local and pure |
| Storage | compressed accounts, ~15,000 lamports, Light state trees, upgradeable | plain 202-byte PDA, 1,676,400 lamports, refundable |
| Namespaces | none | first-class |
| Status | README: *"unaudited, use at your own risk"* | also unaudited — see below |

Adoption of the Light program is negligible (71 crate downloads; its npm package last
published 2026-02-05; Light has since announced it is "joining Helius"), but that is a
market observation, not a technical argument — the technical differences above are the
reason this project was not stopped.

The full landscape survey, with sources and raw notes, is in
[`docs/PRIOR_ART.md`](docs/PRIOR_ART.md).

**What is genuinely new here** is not the receipt-PDA-abort-if-exists mechanism, which is old
and widely used. It is the *combination*: an authority-scoped key space enforced by the
protocol, a self-contained instruction that needs no RPC or prover, explicit namespaces, a
bounded retention window with a refundable deposit and permissionless cleanup, and the
productization around it.

---

## Repository layout

```text
programs/
  commit-once/          the guard program (Anchor 1.2.0)
  demo-counter/         a business program that knows nothing about CommitOnce
packages/sdk/           @commitonce/solana — dual ESM/CJS, zero runtime dependencies
apps/
  demo/                 the A/B demo CLI, and the live contention test — both run against devnet
  web/                  the product site — static, no build step
examples/               SOL transfer, SPL transfer, custom program, Jupiter-style swap
docs/                   architecture, security model, integration playbook, prior art
submission/             the Colosseum submission package
scripts/                build.sh, test.sh
verify.sh               one command that checks all of the above
deploy-keys/            the program keypairs the program IDs are derived from
```

---

## Status

| | |
| --- | --- |
| Program ID (all clusters) | `CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB` |
| Demo counter program | `EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5` |
| Rust tests | 46 passing, exit 0 |
| SDK tests | 71 passing |
| Built for | SBPFv2, Anchor 1.2.0, Solana 4.x toolchain |
| Mainnet | **not deployed** |
| Devnet | **deployed and verified live** — see [`EVIDENCE.md`](EVIDENCE.md) §3 |
| Audited | **no** |
| npm | **not published** |

Nothing in this repository is claimed to be deployed, audited, integrated by a third party,
or used by anyone. Where a capability depends on something this project does not control,
that is stated rather than implied.

### Known limitations

1. **The window is finite unless you choose `permanent`.** After cleanup the key is free
   again. This is a deliberate trade-off, and `closing_frees_the_key_for_a_new_claim`
   asserts it so it cannot be forgotten.
2. **The authority is a single key.** No multisig or threshold authority today.
3. **Durable-nonce transactions require `retention: 'permanent'`.**
4. **A conflicting payload is detected, not resolved.** The program reports it; deciding
   what to do is the application's job.
5. **The fingerprint is only as good as what you put in it.** Pass semantic fields, never
   transport details.
6. **Unaudited.** See [`SECURITY.md`](SECURITY.md).

---

## Documentation

| | |
| --- | --- |
| [QUICKSTART](docs/QUICKSTART.md) | zero to a guarded transaction |
| [CONCEPTS](docs/CONCEPTS.md) | the mental model, and why message-hash dedup is not intent dedup |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | mechanism, layouts, design decisions |
| [SECURITY MODEL](docs/SECURITY_MODEL.md) | threat model, failure modes, non-goals |
| [INTEGRATION PLAYBOOK](docs/INTEGRATION_PLAYBOOK.md) | adding the guard to an existing app |
| [API REFERENCE](docs/API_REFERENCE.md) | every instruction, account, error and export |
| [FAQ](docs/FAQ.md) | the hard questions, answered directly |
| [PRIOR ART](docs/PRIOR_ART.md) | the landscape, with sources |
| [EVIDENCE](EVIDENCE.md) | what was verified, and how |

---

## License

Apache-2.0. See [`LICENSE`](LICENSE).
