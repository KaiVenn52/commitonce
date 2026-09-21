# Evidence

What has actually been verified in this repository, how to reproduce each item, and — just
as importantly — what has **not** been verified. Every claim below is either a command you
can re-run or a value read back from chain state.

Recorded **2026-09-20** (UTC), during the Colosseum Crypto World's Fair 2026 Contest Period
(6:00am PT 2026-09-14 → 11:59pm PT 2026-10-12).

> **Reading rule.** If a claim is not in this document, treat it as unverified. Nothing here
> asserts that CommitOnce is audited, safe for mainnet, integrated by a third party, or used
> by any user. It is not.

---

## 1. Toolchain

| Component | Version | How verified |
| --- | --- | --- |
| `solana-cli` | 4.2.2 (`src:c9c6f328`, `feat:21b0d33a`, client:Agave) | `solana --version` |
| `anchor-cli` | 1.2.0 | `anchor --version` |
| `cargo-build-sbf` | 4.1.0 | `cargo-build-sbf --version` |
| platform-tools | v1.54 | `cargo-build-sbf --version` |
| LiteSVM | 0.10.0 | `programs/commit-once/Cargo.toml` |
| Node.js | 24.20.0 | `node --version` |
| pnpm | 11.24.0 | `pnpm --version` |
| TypeScript | 7.0.2 | resolved in `pnpm-lock.yaml` |

Rust and the Solana toolchain run under **WSL2 Ubuntu**, not on Windows natively. The
repository lives on a Windows drive and builds against `CARGO_TARGET_DIR` on ext4, because
the Windows filesystem is too slow for the Solana linker.

---

## 2. Build artifacts

Produced by `bash scripts/build.sh`.

| Artifact | Size | SHA-256 |
| --- | --- | --- |
| `target/deploy/commit_once.so` | 154,416 bytes | `d6a465a7541c0b954519f5b5eb4b99a960389e43e454cf690fbeeb6f62643108` |
| `target/deploy/demo_counter.so` | 138,064 bytes | `13b2b469276cafe298a511b01c67bc4e7601b37316c1b24b3364fb31f84e04f4` |
| `target/idl/commit_once.json` | 14,841 bytes | — |
| `target/idl/demo_counter.json` | 3,778 bytes | — |

### Target architecture, and why

`readelf -h` on both programs reports:

```
Class:   ELF64
Type:    DYN (Shared object file)
Machine: <unknown>: 0x107      # SBF
Flags:   0x2                   # SBPF v2
```

`anchor build` defaults to `--arch v3`, which produces `e_flags = 0x3`. LiteSVM 0.10.0
rejects v3 ELFs with `Instruction(InvalidAccountData)` — the failure that stalled this
project until the header was inspected. The build therefore pins **SBPFv2**
(`scripts/build.sh`, overridable with `SBPF_ARCH=v3`). Shipping v3 would mean shipping a
program the project's own test suite cannot execute. v2 is accepted by LiteSVM, devnet and
mainnet.

### Program ID integrity

A Solana program deployed at an address other than its compiled-in `declare_id!` refuses to
run, so the build verifies the pairing and **exits 1 on mismatch** rather than producing a
silently broken artifact:

```
declare_id!("CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB");   programs/commit-once/src/lib.rs
declare_id!("EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5");   programs/demo-counter/src/lib.rs

deploy-keys/commit_once-keypair.json     CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB
deploy-keys/demo_counter-keypair.json    EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5
```

---

## 3. Devnet deployment — verified live

**Both programs are deployed and executable on devnet.** Read back with
`solana program show <id> --url devnet`:

### `commit_once`

```
Program Id:            CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB
Owner:                 BPFLoaderUpgradeab1e11111111111111111111111
ProgramData Address:   29tT1XTCZ9bPCvBP93S4z9oxt9EChWv3hWWmLzpSED5x
Authority:             25TUohqYd5b6f97wc5CjMwj89ZVL8oX81nhkWVHimYpY
Last Deployed In Slot: 501995361
Data Length:           163712 (0x27f80) bytes
Balance:               0.8325358 SOL
```

Deploy signature:
`3YsTFBpCenHgYb3pPCNPusvznRsF8gLGEarStQ59dqHjxKchSCjFkh1fjuGZ5RqTcZzKau6Ts2P1yUgX4MNEuRcb`

This is the **second** deployment of `commit_once`; the first was at slot `501814672`. It was
redeployed after the durable-nonce scan was changed to fail closed (§4), so that the live program
matches the source it is described by. `Data Length` is larger than the `.so` because the loader
allocates headroom for future upgrades. Receipt PDAs written by the first deployment survive the
upgrade — the layout did not change — which is the upgrade path the release runbook describes.

### `demo_counter`

```
Program Id:            EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5
Owner:                 BPFLoaderUpgradeab1e11111111111111111111111
ProgramData Address:   CkDRD9ai9jY8zxizKFWxa4qc5zvvA9iZ7Fd63GCYhqKw
Authority:             25TUohqYd5b6f97wc5CjMwj89ZVL8oX81nhkWVHimYpY
Last Deployed In Slot: 501814798
Data Length:           138064 (0x21b50) bytes
Balance:               0.70224396 SOL
```

Deploy signature:
`MMEK7Kxf5fuGo9ananBzMUx2fkk9JBmetFK3HVeZgJ4QcP5o2mGQPJtg2mvGSvJVMWuSt4fsp5eJXKwVWJAWtgA`

### Reproduce

```bash
export HOME=/home/dell2u
solana program show CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB --url devnet
solana program show EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5 --url devnet
solana confirm -v 3YsTFBpCenHgYb3pPCNPusvznRsF8gLGEarStQ59dqHjxKchSCjFkh1fjuGZ5RqTcZzKau6Ts2P1yUgX4MNEuRcb --url devnet
```

Both programs are **upgradeable**, with `25TUohqYd5b6f97wc5CjMwj89ZVL8oX81nhkWVHimYpY` as
the upgrade authority. That is disclosed rather than glossed over: an upgradeable program is
not the same trust model as an immutable one, and a mainnet deployment decision must account
for it (see `RELEASE_RUNBOOK.md`).

**Not verified:** mainnet deployment. Neither program has been deployed to mainnet, and no
mainnet keypair or funding exists for it.

### The A/B demo, run against devnet

`apps/demo/commitonce-demo.ts` was executed against devnet on **2026-09-21**, against the
deployed programs above. It sends the *same logical intent* twice, as two genuinely rebuilt
transactions (fresh blockhash, 50× priority fee on attempt 2), once without the guard and once
with it. Full output: [`submission/evidence/devnet-demo-run.log`](submission/evidence/devnet-demo-run.log).

```
  scenario          counter onchain  expected  result  attempts that executed
  A  without-guard  2                2         PASS    2 of 2
  B  with-guard     1                1         PASS    1 of 2

  A1  first send                     success                    counter 1  JPq28VZBd56Y5P5fSEzdg9HuxczdVXR626F1Evm7TA2KvcjvJHz9gSfi58N3zoUxkJosFURxFyBkCVihK9MbrA9
  A2  rebuilt (new blockhash + fee)  success                    counter 2  2ccU3YPhcHfMqa3kzi7iuFLU7rCfkz6upBrvuZuf3FaTFpepHZWs5QcvV2dtgph8qd73vGQV4hguLZjDoUaCDkgu
  B1  first send                     success                    counter 1  5x94gsThRdov1HB7EsJ9jhFX8ZhFNvAdCm7ZizCSuuxg2L2KqfTKtFueTJLCs7K1Xv9wWvhh1GCdFVeQBw7UjsaD
  B2  rebuilt (new blockhash + fee)  FAILED: already-committed  counter 1  4beKGRxVKN7WRNnP9FvmFqsnwZjc4scfwBNKaRmapzSYmvaoT6M4VGeDh9XfSUHwv9disHQn9nae2gdYys9H1rMU
```

Every signature above is a real transaction that reached devnet. The failing one is onchain
too: it was submitted with `skipPreflight` enabled, so the runtime included it in a block and
rejected it rather than simulation turning it away — which is the case that matters, because
it shows the guard aborting an already-built transaction rather than merely discouraging it.

Verify any of them independently:

```bash
solana confirm -v JPq28VZBd56Y5P5fSEzdg9HuxczdVXR626F1Evm7TA2KvcjvJHz9gSfi58N3zoUxkJosFURxFyBkCVihK9MbrA9 --url devnet
solana confirm -v 4beKGRxVKN7WRNnP9FvmFqsnwZjc4scfwBNKaRmapzSYmvaoT6M4VGeDh9XfSUHwv9disHQn9nae2gdYys9H1rMU --url devnet
```

**What it does not prove:** this is one run of one intent shape on one cluster. It is not load
testing, and it says nothing about mainnet conditions. Concurrent claims of one key are covered
separately, immediately below.

### Live contention — many claims of one key at once

`apps/demo/concurrent-claim.ts` is the test the Rust suite cannot be: it puts the same
idempotency key into several transactions and fires them at **real validators**. The LiteSVM
suite proves the invariant against the compiled program, but in-process and single-threaded;
this measures what a live cluster does. Full output:
[`submission/evidence/devnet-contention-run.log`](submission/evidence/devnet-contention-run.log).

It mints a fresh authority, creates its counter, reads **one** blockhash, builds N transactions
against it — all therefore targeting the same slot — gives each a different priority fee so each
is a distinct signed transaction rather than a rebroadcast, fires them all without awaiting any
of them, and then confirms them with a single batched status poll.

```
  #  priority fee  slot       outcome  error
  0  1000          501956389  SUCCESS  succeeded
  1  8000          501956391  FAILED   instruction 1 failed with custom program error 6000
  2  15000         501956391  FAILED   instruction 1 failed with custom program error 6000
  3  22000         501956391  FAILED   instruction 1 failed with custom program error 6000
  4  29000         501956391  FAILED   instruction 1 failed with custom program error 6000

  attempts                5
  succeeded               1
  blocked with AlreadyCommitted 4
  distinct slots landed in 2  (501956389, 501956391)
  counter before          0
  counter after           1
  business action executions 1
  receipt exists          yes
  event created_slot      501956389
```

Exactly one of five committed; the other four were rejected onchain with `AlreadyCommitted`
(6000), not in simulation; the counter advanced by exactly one; and the decoded event's
`created_slot` matches the winning transaction's slot.

**What it does not prove — and this is the honest part.** The attempts landed in **two** slots,
not one. Three runs (5, 8 and 5 attempts) all showed the same shape: the winner lands alone in an
earlier slot and the losers pack into the following one. That is structural, not a flaw in the
guard — a slot's leader decides what to pack, and a client cannot force two transactions into one
slot. So this run demonstrates **live-cluster contention**, and the **same-slot** case rests on
the LiteSVM test `only_the_first_of_many_attempts_commits`, where five claims built against one
blockhash are processed at one slot. Between them the invariant is covered in-process and
onchain, but the two are not the same experiment and the log does not claim they are.

The run is also cheap to repeat: it sweeps the unspent balance back to the payer (0.0071 SOL of
the 0.01 funded). The receipt's 0.0016764 SOL stays locked for the retention window, which is
`close_receipt` refusing early by design rather than a leak.

### Real integrations — the guard composed with other programs, on devnet

The two runs above use the demo counter, which exists only to make the guard observable. The
question a composability claim has to answer is whether the guard works when it is wrapped
around **somebody else's program**. Two of the four examples have been executed against devnet,
against the deployed CommitOnce program:

| Example | Composed with | Result |
| --- | --- | --- |
| [`sol-transfer`](examples/sol-transfer/) | System Program `Transfer` | phase 1 committed; phase 2 blocked; recipient gained exactly one transfer |
| [`spl-transfer`](examples/spl-transfer/) | SPL Token `TransferChecked` + Associated Token `CreateIdempotent` | phase 1 committed; phase 2 blocked; source fell by exactly one transfer |
| [`custom-program`](examples/custom-program/) | an arbitrary Anchor program (`demo-counter`) | phase 1 committed; phase 2 blocked; counter stayed at 1 |

The `custom-program` run is worth calling out separately, because phase 1 and phase 2 carried
**different numbers of business instructions** — phase 1 had `initialize` *and* `increment`,
since the counter did not exist yet, while phase 2 had only `increment`. The guard blocked the
retry anyway, which is precisely the case a naive "compare the transaction message" approach
gets wrong.

The `spl-transfer` run is the stronger of the two, because it puts **two** third-party programs
in the same atomic transaction as the guard, and one of them (the ATA program) is conditional on
state that may or may not already exist. Its instruction order:

```
  0. compute budget  SetComputeUnitPrice   (transport only)
  1. commit_once     claim                 (the guard)
  2. ATA program     CreateIdempotent      (destination token account, if absent)
  3. SPL Token       TransferChecked       (the business instruction)
```

Full output:
[`submission/evidence/devnet-spl-transfer-run.log`](submission/evidence/devnet-spl-transfer-run.log)
and
[`submission/evidence/devnet-sol-transfer-run.log`](submission/evidence/devnet-sol-transfer-run.log).

```
  # spl-transfer
  phase 1               committed after 1 attempt(s)
  phase 2               duplicate-blocked after 1 attempt(s)
  source before/after   1000000000 -> 999000000
  destination before    0
  destination after     1000000
  delta                 1000000 base units (one transfer, not two)
  receipt matches       true

  # sol-transfer
  phase 1            committed after 1 attempt(s)
  phase 2            duplicate-blocked after 1 attempt(s)
  recipient before   0 lamports
  recipient after    1000000 lamports
  delta              1000000 lamports (one transfer, not two)
  receipt matches    true
```

In both, phase 1 committed on the first attempt, and phase 2 rebuilt the transaction with a
fresh blockhash and the same idempotency key and was blocked with `AlreadyCommitted` (6000).
The `spl-transfer` log's own words are *"duplicate blocked, no ATA rent paid and no tokens
moved"*.

The devnet state `spl-transfer` needs is created by
[`examples/spl-transfer/setup-devnet.sh`](examples/spl-transfer/setup-devnet.sh), so it is
reproducible rather than a one-off. `sol-transfer` needs only a funded keypair and any recipient
address.

**What this proves:** the guard composes with the System Program, the SPL Token program, the
Associated Token program and an arbitrary Anchor program, in one atomic transaction each, on a
live cluster, with the instruction ordering the examples argue for. **What it does not prove:**
anything about mainnet, and it does not make the program audited. The Jupiter-swap example is
still structural — it has never submitted a transaction, and it has never been run against
Jupiter's live API.

---

## 4. Rust test suite — 42 passing, exit code 0

Run: `bash scripts/test.sh`

```
test result: ok. 11 passed; 0 failed    (invariant)
test result: ok.  9 passed; 0 failed    (retention)
test result: ok. 11 passed; 0 failed    (security)
test result: ok. 10 passed; 0 failed    (wire_format)
test result: ok.  1 passed; 0 failed    (benchmarks)
REAL_EXIT=0   TOTAL_PASSED=42   TOTAL_FAILED=0
```

The tests execute the **real compiled SBF artifact** through LiteSVM — not a mock and not a
reimplementation of the program. They assert on observable onchain state: counter values,
account existence, lamport balances, PDA addresses, account data lengths. No test asserts on
an error message string, because message text is not a stable contract.

### The load-bearing scenarios

| Scenario | Test | Asserts |
| --- | --- | --- |
| **The bug, demonstrated** | `without_guard_two_rebuilt_transactions_execute_twice` | two rebuilt transactions both commit; counter = 2 |
| **The fix** | `with_guard_rebuilt_retry_is_blocked_and_business_action_runs_once` | second attempt fails `AlreadyCommitted`; counter = 1 |
| Atomic rollback | `downstream_failure_rolls_back_the_receipt` | receipt rolls back with the business action; only the fee is spent |
| Race | `only_the_first_of_many_attempts_commits` | five same-slot attempts → exactly one commit; the four losers each fail with `AlreadyCommitted`, and all five are processed at one slot |
| Same intent, different payload instructions | `same_intent_with_different_downstream_instructions_is_still_blocked` | the guard keys on the intent, not on what follows it; the losing attempt's transfer does not happen |
| Runtime dedup preserved | `identical_rebroadcast_still_rejected_by_the_runtime` | CommitOnce does not interfere with message-hash dedup |
| Guard transparency | `guard_is_transparent_to_the_business_instructions` | the guarded path produces identical business state |
| Authority scoping | `third_party_cannot_consume_another_authoritys_key` | an attacker front-running with the victim's exact key does not block the victim |
| Namespace scoping | `same_textual_key_under_different_namespaces_does_not_collide` | — |
| Conflict detection | `same_key_different_payload_is_an_idempotency_conflict` | stored fingerprint stays immutable |
| Receipt substitution | `receipt_pda_cannot_be_substituted_across_authorities` | `seeds` constraint holds |
| Foreign-owned account | `receipt_with_foreign_owner_is_rejected` | owner checked before trusting existing state |
| Malformed state | `malformed_receipt_data_is_rejected`, `unsupported_receipt_version_is_rejected` | fail-closed |
| Expiry | `receipt_cannot_be_closed_before_expiry` | both deadlines independently enforced |
| **Durable-nonce scan bound** | `scan_bound_sits_above_the_runtime_instruction_ceiling` | discovers the runtime's own instruction ceiling by probing, then asserts `MAX_INSTRUCTION_SCAN` sits above it — see below |

### The durable-nonce scan, and a finding from auditing it

`claim` refuses a durable-nonce transaction when the retention is finite, because a nonce
transaction never expires and cleanup would later reopen the duplicate window. It detects one by
scanning the transaction's instructions for a System Program `AdvanceNonceAccount`.

That scan is bounded by `MAX_INSTRUCTION_SCAN`, and the bound originally **failed open**: running
out of budget returned "no nonce found". Padding a transaction with filler instructions would
therefore have hidden a real nonce past the bound and let a caller combine a nonce with a finite
retention — precisely what the check exists to prevent.

The scan now **fails closed**, returning `InstructionScanInconclusive` (6011) rather than
guessing. Auditing that change turned up the more interesting fact: **the SVM caps a transaction
at its own instruction ceiling** (`MaxInstructionTraceLengthExceeded`), which the test discovers
by probing rather than hardcoding, because the first attempt to hardcode it from memory was wrong
by one. So the refuse branch is currently unreachable — but it is unreachable because of a
constant owned by another codebase, which is exactly the kind of thing that changes without
warning. `scan_bound_sits_above_the_runtime_instruction_ceiling` asserts the relationship, so if
a future runtime raises its ceiling past 128, the suite fails and says to raise the bound rather
than silently reopening the hole.

The same test confirms the largest transaction the runtime allows is still scanned to completion,
so the bound does not cause spurious refusals at the ceiling.
| Rent | `close_returns_rent_deposit_to_the_configured_destination`, `close_requires_the_configured_refund_destination` | deposit cannot be redirected |
| Reopen (documented cost) | `closing_frees_the_key_for_a_new_claim` | the window is finite, asserted not just described |
| Nonce policy | `durable_nonce_transaction_is_rejected_for_finite_retention`, `..._allowed_for_permanent_retention`, `ordinary_transactions_are_not_mistaken_for_nonce_transactions` | policy holds in both directions |
| Wire format | `receipt_account_layout_is_exactly_202_bytes`, `counter_account_layout_is_exactly_88_bytes`, `rent_deposit_matches_the_mainnet_rate` | layout and rent pinning |

---

## 5. SDK test suite — 71 passing

Run: `pnpm --filter @commitonce/solana test`

```
Test Files  2 passed (2)
     Tests  71 passed (71)
```

48 of these pin the derivation to **golden hex vectors**: namespace hashes, key hashes, payload
fingerprints, and receipt PDA addresses.

The vectors are cross-checked by a second, independent implementation:
`packages/sdk/scripts/print-vectors.mjs` recomputes the same values directly from
`@solana/kit` primitives **without importing the SDK**. The Rust suite pins the same
derivation in `programs/commit-once/tests/wire_format.rs`. Three implementations agreeing is
a much stronger signal than one suite agreeing with itself.

The other 23 cover **event decoding** (`test/events.test.ts`). These are pinned against a real
`IntentCommitted` emitted by the deployed program on devnet, captured verbatim in
`submission/evidence/devnet-demo-run.log`. The captured event corroborates against the same log
in four independent ways:

| Decoded field | Corroboration in the recorded run |
| --- | --- |
| `createdSlot` = `501846624` | the transaction reported `SUCCESS — slot 501846624`, and the losing retry was rejected with `already committed at slot 501846624` |
| `namespaceHash` | matches `demo:counter`, the namespace the demo printed, under `commitonce/namespace/v1` |
| `idempotencyKeyHash` | matches `verify_20260921_175355`, the key the demo printed, under `commitonce/key/v1` |
| the two deadlines | differ by exactly `86_400` s and `345_600` slots (= 86 400 × 4), matching the demo's `retention 86400 seconds` |

Also verified: the package builds to `dist/esm`, `dist/cjs` and `dist/types`, and resolves
correctly under **both** module systems. This is checked by
`pnpm --filter @commitonce/solana check:dual`, which imports the built package through the
`import` condition and `require`s it through the `require` condition, then compares the two
builds:

```
ESM  ok  (15 exports, 9 constants)
CJS  ok  (15 exports, 9 constants)
both builds decode the real devnet IntentCommitted identically

dual-format check PASSED: both builds load and agree.
```

The check asserts that every public export is present in **both** builds and that the pinned
constants are equal across them, so a green result means the two builds are the same code, not
merely that both are loadable. It also decodes the captured devnet event in each build and
compares the results, so a module added to one entry point and not the other fails here.

Dual-format output is verified by actually importing it both ways, not by inspecting the
build output.

### And the package installs, which nothing else here proves

Every check above runs inside the workspace, where the SDK is reached through a pnpm symlink.
**A symlink hides exactly the faults that break a real install**: a missing `files` entry, an
`exports` map that does not resolve, a `types` path pointing at nothing, a runtime dependency
that was only present because the monorepo hoisted it to the root. Nobody outside this
repository has ever installed the package, so `scripts/check-package.mjs` stands in for the
first person who does. It packs the SDK, installs the tarball into a throwaway project in the
OS temp directory, and asserts:

```
1/6  cleaning the sandbox
2/6  packing the SDK
     commitonce-solana-0.1.0.tgz  51191 bytes
3/6  installing into a project outside the workspace
     installed to ...\Temp\commitonce-sdk-consumer\node_modules\@commitonce\solana
4/6  checking what the tarball actually ships
     contents: LICENSE README.md dist package.json
5/6  running the consumer under ESM and CJS
     ESM consumer: all assertions passed
     CJS consumer: all assertions passed
6/6  typechecking a consumer against the shipped types
     (no type errors)
```

The assertions are not smoke tests. The consumer reproduces the **golden PDA vector** pinned in
`test/vectors.test.ts`, reads the pinned rent and account-size constants, and classifies a real
error string — under both module systems — and then TypeScript resolves the shipped `.d.ts`
with the monorepo absent. The check also fails if the install resolves back into the workspace,
because that would make every assertion vacuous, and if the tarball ships `src/`, `test/`,
`scripts/` or `tsconfig.json`.

**This one needs the network**, since `npm install` fetches `@solana/kit`. That is why it is
not part of `verify.sh`, which is deliberately hermetic. Run it with
`node scripts/check-package.mjs`.

The `LICENSE` file in the tarball is worth noting: it is shipped because npm includes it
automatically, not because it is listed in `files`.

---

## 6. Measured overhead

Run: `bash scripts/test.sh --test benchmarks -- --nocapture`

| | Business action alone | With the guard | Delta |
| --- | --- | --- | --- |
| Transaction size (legacy) — exact | 273 bytes | 677 bytes | +404 bytes |
| Accounts — exact | 3 | 7 | +4 |
| Compute units — observed range | 4,067 – 10,067 | 12,404 – 22,904 | +8,337 – +12,837 |

| Operation | Compute units (range) | Median |
| --- | --- | --- |
| `claim` alone | 7,783 – 12,283 | 9,283 |
| `claim` + business action | 12,404 – 22,904 | 15,404 |
| Duplicate blocked (rebuilt retry) | 8,053 – 11,053 | 8,053 |
| `close_receipt` (cleanup) | 2,701 – 2,701 | 2,701 |

| Receipt account — exact | |
| --- | --- |
| Data length | 202 bytes |
| Rent deposit | 1,676,400 lamports (0.0016764 SOL) |
| `claim` instruction data | 144 bytes |
| `claim` accounts | 4 |

**The same operation measured on devnet**, from the recorded demo run in
[`submission/evidence/devnet-demo-run.log`](submission/evidence/devnet-demo-run.log):

| Operation | Compute units reported by the cluster |
| --- | --- |
| `claim` (succeeded) | 14,669 |
| `claim` (blocked a duplicate) | 13,977 |
| Business increment | 4,067 and 7,067 in the same run |

**Provenance of each number, stated precisely:**

* **Measured, exact** — the receipt data length, the deposit, and the `claim` instruction size
  and account count. These are read from the account store or the instruction itself and are
  identical on every run, so the benchmark asserts them exactly.
* **Measured, non-deterministic** — all compute-unit figures. LiteSVM's compute accounting is
  not reproducible run to run: the same unmodified test binary running the same byte-identical
  `.so` reported a bare counter increment at 5,567, 7,067 and 19,067 CU across three
  consecutive runs. The figures above are therefore a min/median/max over 9 independent
  environments, and the cluster's own figures (which differ from the harness's) are given
  separately. Quoting a single compute-unit value would be fabricated precision that a reader
  could not reproduce.
* **Computed** — transaction wire size. LiteSVM does not report serialized size, so it is
  computed from the legacy message wire format by `legacy_wire_size()` in
  `tests/benchmarks.rs`. The formula is written out in full so it can be checked by hand.
  The +404-byte delta decomposes exactly as 128 bytes of added account keys (4 × 32) plus a
  276-byte instruction, and both components were verified arithmetically.

**Context that keeps these numbers honest:**

* **The structural numbers carry the claim; the compute numbers do not.** +404 bytes and +4
  accounts are exact. The compute-unit figures are a range, and the range is wide.
* Budget against the **top** of the range: ~23,000 CU for a guarded transaction, which is about
  11% of the 200,000 CU default budget and well under the 400,000 CU limit the demo
  transactions were granted on devnet.
* The baseline is a trivial counter increment, so on a real business action the *relative* cost
  is much lower.
* The +4 accounts are the receipt PDA, the Instructions sysvar, the System program, and the
  CommitOnce program id. In a typical transaction the System program is already present, so
  it is usually **+3**.
* The deposit is fully refunded by `close_receipt`; only the cleanup transaction fee is
  spent.
* Rent uses mainnet's **5080 lamports/byte** since SIMD-0437 step 2. The `solana-rent` Rust
  crate still ships a stale effective 6960 lamports/byte, so any estimate derived from it is
  **37% too high**. The test harness overrides the Rent sysvar to the real value so these
  figures are accurate.

### The rent figure, verified against live chain state

The rent rate was not taken from a crate constant or a document. It was read directly out of
the **live mainnet Rent sysvar** and decoded:

```bash
solana account SysvarRent111111111111111111111111111111111 \
  --url https://api.mainnet-beta.solana.com --output json
```

The account data is `2BMAAAAAAAAAAAAAAADwPzI=` in base64, which decodes as:

| Field | Offset | Value |
| --- | --- | --- |
| `lamports_per_byte_year` (u64 LE) | 0 | **5080** |
| `exemption_threshold` (f64 LE) | 8 | **1.0** |
| `burn_percent` (u8) | 16 | **50** |

So `(202 data + 128 overhead) × 5080 × 1.0 = 1,676,400` lamports. Confirmed independently
by asking both clusters directly:

```
$ solana rent 202 --url https://api.devnet.solana.com
Rent-exempt minimum: 0.0016764 SOL

$ solana rent 202 --url https://api.mainnet-beta.solana.com
Rent-exempt minimum: 0.0016764 SOL
```

This matters because the stale crate constant would have produced a figure 37% higher, and
a wrong cost number in a payments product is a real defect. Three independent sources — the
live sysvar, the CLI on two clusters, and the LiteSVM harness — now agree.

---

## 7. What is NOT verified

Listed explicitly, because a document that only lists successes is not evidence.

| Claim | Status |
| --- | --- |
| Mainnet deployment | **Not done.** No mainnet keypair or funding. |
| Security audit | **Not done.** The program is unaudited. |
| npm publication | **Not done.** `@commitonce/solana` is not published. The name and scope are unclaimed as of the name check. |
| Third-party integration | **None.** No external project uses CommitOnce. |
| Real users | **None.** |
| Traction, revenue, waitlist | **None.** No such numbers exist and none are claimed. |
| Concurrent claims of the same key | **Tested, in two places, with a caveat.** In-process, `only_the_first_of_many_attempts_commits` builds five distinct signed transactions against one blockhash — i.e. one slot — and asserts exactly one commits while the other four each fail with `AlreadyCommitted`. On a live cluster, `apps/demo/concurrent-claim.ts` fires 5–8 competing transactions at real devnet validators and gets the same result (exactly one commits, the rest fail 6000). **The caveat:** the live runs spread across 2–3 slots rather than one, because a client cannot force a leader to pack its transactions together. So the same-slot case is proven in-process and the live case is proven across slots; neither experiment is the other. |
| Transaction v1 (`VersionedTransaction` v1) | **Not tested.** v1 is live on mainnet as of epoch 1035, and it does not change message-hash deduplication, but the SDK and tests exercise legacy and v0 messages only. |
| Address lookup tables / v0 messages | **Not tested end-to-end.** The guard is an ordinary instruction and is expected to work, but "expected" is not "verified". |
| Non-Anchor callers | **Not tested.** The program is Anchor-built; the SDK encodes the wire format by hand, so a non-Anchor client can call it, but no such client has been written or run. |
| Durable-nonce transactions, genuine | **Cannot be tested in LiteSVM 0.10.0.** A real nonce transaction is inexpressible there, because LiteSVM passes the transaction's own blockhash into the program environment, making the System Program's advance check and the runtime's nonce validation mutually exclusive. The tests assert the program's stricter behaviour — that the *presence* of the marker triggers the policy — and this limitation is documented at length in `tests/security.rs`. |
| SBPFv3 build | **Not verified.** Deliberately not shipped, because LiteSVM cannot verify it. |
| CU figures on mainnet | **Not measured.** And the harness does not match the runtime: devnet reported `claim` at 14,669 CU against the harness's 9,283 median, so the in-process numbers are a lower bound. |

---

## 8. One-command verification

```bash
bash verify.sh
```

Runs prerequisite checks, the program build, program-ID verification, the Rust suite, the
benchmarks, and the SDK typecheck/build/tests/dual-format check plus a consumer typecheck, the
brand-asset check and the documentation check — **twelve steps** — then prints a PASS/FAIL
summary with the true exit code. It fails loudly rather than silently skipping a step, and a step
that could not run is reported as `NOT RUN`, which fails the run rather than being counted as a
pass.

Last full run: **`RESULT: PASS (12 steps ran and passed)`**, exit code 0.

One step it deliberately does **not** run is `scripts/check-package.mjs`, which installs the SDK
tarball into a throwaway project and needs the network. `verify.sh` is hermetic by design, and its
header says so.

One caveat worth stating, because it is a property of this machine rather than of the project:
the SDK steps are delegated to the Windows toolchain through WSL interop. This dependency tree
contains win32-only native binaries — TypeScript 7 itself is a native executable, as are
esbuild, rolldown and lightningcss — so `pnpm` inside WSL cannot run them. `verify.sh` detects
that from the presence of those packages and routes the SDK steps to the toolchain that owns
`node_modules`, reporting the mode it chose in its header. On a machine with a single
toolchain it runs everything natively.

The examples are typechecked as part of the workspace (`pnpm -r typecheck`), so a change to the
SDK that breaks an integration example fails the build rather than rotting silently. One of the
four — `examples/spl-transfer` — has additionally been executed against devnet; see §3. The other
three are structural.
