# Contributing to CommitOnce

CommitOnce is an onchain idempotency guard for Solana. Its whole value is one property, so
almost every rule below exists to protect that property and the evidence for it:

> For one (authority, namespace, idempotency key) tuple, no more than one guarded
> transaction may successfully commit during the receipt retention period

This is **at-most-once successful execution within a retention window**, not universal
exactly-once execution. Do not describe it as "exactly once" in code comments, docs, commit
messages, package descriptions, or pull requests. Combined with client retry-until-success it
gives exactly-once-style application semantics; that is the strongest honest phrasing.

Contributions are welcome. The project is unaudited and not deployed to mainnet — see
[`SECURITY.md`](SECURITY.md) — so expect review to be slow and pedantic about tests.

---

## 1. Environment

### What you need

| Tool | Version | Notes |
| --- | --- | --- |
| WSL2 Ubuntu | any current release | Rust and the Solana toolchain do **not** run on Windows natively for this project |
| Rust | 1.89.0 | pinned by `rust-toolchain.toml`, with `rustfmt` and `clippy` components |
| Solana CLI | 4.2.2 | supplies `cargo-build-sbf`; version recorded in `EVIDENCE.md` §1 |
| Anchor CLI | 1.2.0 | pinned; `anchor build` behaviour differs across versions |
| Node.js | >= 20.18.0 | required by `@solana/kit`; `apps/demo` declares >= 22.18.0 |
| pnpm | 11.24.0 | pinned by `packageManager` in the root `package.json` |

`cargo build-sbf --version` should also report the platform-tools version (v1.54 was used
for the recorded artifacts). A different platform-tools build changes the emitted ELF, so if
your artifact hashes differ from `EVIDENCE.md` §2, check this first.

### Two environment variables that are not optional in WSL

The repository is developed on a Windows drive and built under WSL2 Ubuntu. Both of the
following are required, and `scripts/build.sh` / `scripts/test.sh` set them for you:

```bash
export HOME=/home/dell2u
export CARGO_TARGET_DIR=/home/dell2u/cot-target
```

**Why `HOME=/home/dell2u`.** The toolchains live under that home: `~/.cargo/bin` (cargo,
`avm`-managed `anchor`), `~/.config/solana` (CLI config and keypair), and the nvm-managed
Node installation. If you run the scripts with a different `HOME`, cargo looks for a registry
and a toolchain in the wrong place, `anchor` disappears from `PATH`, and the failure surfaces
as `command not found` or a missing-wallet error rather than as "your HOME is wrong". The
scripts export it unconditionally for that reason. If your toolchains live elsewhere, edit
the scripts rather than fighting them — and expect to update this document in the same
commit.

**Why `CARGO_TARGET_DIR` points at ext4.** The repository lives on a Windows filesystem
mounted into WSL (`/mnt/c/...`). Cargo's incremental cache and the Solana linker write
hundreds of megabytes of small files, and on that filesystem the build goes from slow to
unusable. Pointing `CARGO_TARGET_DIR` at native ext4 keeps the cache off the Windows drive,
and `scripts/build.sh` copies the small outputs back into the workspace so the artifacts stay
inspectable from Windows:

```
target/deploy/*.so      target/idl/*.json      target/types/*.ts
```

One consequence worth knowing: Anchor's deploy directory follows `CARGO_TARGET_DIR`, so the
program keypairs are read from `$CARGO_TARGET_DIR/deploy`, not from `<repo>/target/deploy`.
`scripts/build.sh` force-copies `deploy-keys/*-keypair.json` into both locations, because
Anchor compares `declare_id!` against whatever keypair it finds there and a stale or
auto-generated keypair would either break the build or silently change the program ID.

### Install and build

```bash
git clone <your fork> commitonce
cd commitonce
pnpm install --frozen-lockfile     # workspace root; .npmrc pins exact versions
bash scripts/build.sh              # builds both programs, then verifies program IDs
bash scripts/test.sh               # runs the Rust suite against the compiled SBF artifact
bash verify.sh                     # everything, with a PASS/FAIL summary
```

`pnpm install` needs `esbuild`'s postinstall to link its native binary. pnpm 11 blocks
lifecycle scripts by default, so `pnpm-workspace.yaml` allowlists exactly that one package.
Adding a dependency that needs a build script means adding it there deliberately — and
justifying it, because a dependency with a postinstall script is a supply-chain surface the
rest of this tree does not have.

### SBPF target: v2, not v3

`anchor build` defaults to `--arch v3`, whose ELF carries `e_flags = 0x3`. **LiteSVM 0.10.0
cannot verify a v3 ELF** and rejects it with `Instruction(InvalidAccountData)`, so a v3 build
would produce a program that this project's own test suite cannot execute. The build
therefore pins `--arch v2` (SBPFv2, accepted by LiteSVM, devnet and mainnet), overridable
with `SBPF_ARCH=v3` once the harness supports it.

Do not change this default without also changing the test harness and recording why in
`docs/ARCHITECTURE.md` §10 and `EVIDENCE.md`.

---

## 2. Build and test commands

| What | Command |
| --- | --- |
| Build both programs + verify program IDs | `bash scripts/build.sh` |
| Rust suite (55 tests, LiteSVM, real compiled artifact) | `bash scripts/test.sh` |
| SDK installs and works as a package (needs network) | `node scripts/check-package.mjs` |
| One Rust test file | `cargo test -p commit-once --test invariant` |
| Benchmarks with output visible | `cargo test -p commit-once --test benchmarks -- --nocapture` |
| SDK typecheck | `pnpm --filter @commitonce/solana typecheck` |
| SDK build (ESM + CJS + types) | `pnpm --filter @commitonce/solana build` |
| SDK tests (71 tests) | `pnpm --filter @commitonce/solana test` |
| Recompute golden vectors independently | `pnpm --filter @commitonce/solana vectors` |
| Formatting check | `cargo fmt --all --check` |
| Lints | `cargo clippy --workspace --all-targets` |
| End-to-end gate | `bash verify.sh` |

The Rust tests locate the compiled programs through `COMMIT_ONCE_DEPLOY_DIR`, which
`scripts/test.sh` defaults to `$CARGO_TARGET_DIR/deploy`. If you run `cargo test` directly
without that variable, the tests fall back to `<repo>/target/deploy` and will fail with an
explicit "build the programs first" panic if no artifact is there. They never silently skip.

The Rust suite executes the **real compiled SBF artifact** through LiteSVM. It is not a mock
and not a reimplementation. If you change the program and forget to rebuild, the tests run
the old artifact — so always `bash scripts/build.sh` before `bash scripts/test.sh`.

---

## 3. Tests: assert on observable state

**A behavioural change must come with a test that asserts on observable onchain state.** This
is not a style preference; it is the only thing that makes the suite evidence.

Assert on state that exists after the transaction is processed:

* counter values and other business-program state,
* account existence and account ownership,
* lamport balances (deposits, refunds, fees),
* PDA addresses and account data lengths,
* decoded receipt fields (authority, hashes, deadlines).

**Do not assert on error message strings.** Message text is not a contract: it changes with
Anchor versions, it is not part of the wire format, and a test that asserts on a string can
pass while the state transition is wrong. Asserting on the numeric custom error **code** is
acceptable — codes are the machine-readable part of the interface, and the SDK enumerates
them in `packages/sdk/src/errors.ts` — but a code-only assertion is not sufficient on its
own for anything that guards the invariant. Pair it with a state assertion:

```rust
// Two genuinely rebuilt transactions: fresh blockhash, different priority fee.
// The runtime's message-hash dedup cannot help here, which is the point.
let attempt_1 = env.send_distinct(&[claim, increment], 1);
let attempt_2 = env.send_distinct(&[claim, increment], 2);

assert_success(&attempt_1);
assert_custom_error(&attempt_2, E_ALREADY_COMMITTED);
assert_eq!(env.counter_value(&authority), 1);   // ran exactly once — the assertion that matters
```

Rules that follow from this:

* **A bug fix needs a regression test that fails before the fix.** If you cannot make it
  fail, you have not found the bug.
* **A change to the guard needs a test that would catch its removal.** For anything touching
  the invariant, write the scenario that would break it if your change were wrong.
* **Negative cases matter as much as positive ones.** `ordinary_transactions_are_not_mistaken_for_nonce_transactions`
  exists because an over-eager nonce check would break every normal integration while every
  "nonce is rejected" test still passed.
* **Documented limitations must be asserted.** `closing_frees_the_key_for_a_new_claim` exists
  so that the finite retention window cannot quietly become permanent, or vice versa.
* **Do not add a test that cannot fail.** A test with no assertion, or one that asserts
  something already guaranteed by the type system, is noise.

If your change touches the guarantee, also update `docs/SECURITY_MODEL.md` §8, which lists
the failure modes that would break it alongside the test that guards each one. A failure mode
with no test is a documentation defect; a test with no documented failure mode is a gap in
the threat model.

---

## 4. Documentation

**If behaviour changes, `docs/` changes in the same commit.** Reviewers reject behavioural
changes that leave the documentation describing the old behaviour, because a stale security
document is worse than none.

| Change | Update |
| --- | --- |
| The guarantee, retention, or expiry | `docs/SECURITY_MODEL.md` §1 and §6, `README.md` "The guarantee, stated exactly" |
| Account layout, instruction data, PDA seeds | `docs/ARCHITECTURE.md` §3, §7, §8, and the offset tables in `packages/sdk/src/accounts.ts` |
| A new error code or instruction | `docs/API_REFERENCE.md`, the error table in `packages/sdk/src/errors.ts` |
| Overhead numbers | `docs/ARCHITECTURE.md`, `README.md`, `EVIDENCE.md` §6 (re-measure, do not extrapolate) |
| A new limitation or non-goal | `docs/SECURITY_MODEL.md` §7, `README.md` "Known limitations" |
| Anything about audit, deployment or publication status | `README.md` "Status", `SECURITY.md`, `EVIDENCE.md` §7, `NEEDS_OWNER_ACTION.md` |

Two hard rules for documentation:

* **Never claim the program is audited, deployed to mainnet, published, integrated, or used
  by anyone.** It is none of those. If a status changes, it changes because someone did the
  thing and can point at the evidence.
* **Never upgrade the guarantee to "exactly once" as a universal claim.** Write
  "at-most-once successful execution of a guarded logical intent within the retention
  window".

Measured numbers must be re-measured. Every figure in `README.md`, `docs/ARCHITECTURE.md`
and `EVIDENCE.md` §6 comes from executing the compiled program via
`cargo test -p commit-once --test benchmarks -- --nocapture`; none is estimated. If you
change the program, those numbers change, and copying the old ones forward is a false claim.

---

## 5. Golden vectors: two files, one derivation

The hash and PDA derivation is pinned to fixed hex values in **two** places, deliberately:

| Language | File |
| --- | --- |
| Rust | `programs/commit-once/tests/wire_format.rs` |
| TypeScript | `packages/sdk/test/vectors.test.ts` |

**Changing the derivation requires updating both, in the same commit.** They are not
duplicates of one another: the Rust suite pins what the onchain program accepts, and the
TypeScript suite pins what the SDK produces, so a change that updates only one of them is a
change that has broken the client or the program — and the failing suite is telling you which.

There is also a third, independent implementation used as a cross-check:
`packages/sdk/scripts/print-vectors.mjs` recomputes the same values straight from
`@solana/kit` primitives **without importing the SDK**. It must stay that way. The moment it
imports `@commitonce/solana`, it stops being a cross-check and becomes a second copy of the
thing it is supposed to be testing. Run it with
`pnpm --filter @commitonce/solana vectors` and compare by eye when you touch the derivation.

Domain separators (`commitonce/namespace/v1`, `commitonce/key/v1`) and the
`sha256("global:claim")` / `sha256("account:IntentReceipt")` discriminators are part of the
wire format. Changing any of them is a breaking change that invalidates every existing
receipt, and it needs a version bump plus a migration story, not just new vectors.

---

## 6. Code style

### Rust

* `cargo fmt --all` before every commit; CI checks `cargo fmt --all --check`.
* `cargo clippy --workspace --all-targets` should be clean. The toolchain pins `rustfmt` and
  `clippy` in `rust-toolchain.toml` so the versions are reproducible.
* Onchain code fails closed. Check owners, discriminators and versions **before** trusting
  any pre-existing account, and return a typed error rather than panicking.
* No `unwrap()` or `expect()` on any path a caller can reach, and no arithmetic that can
  overflow silently. The release profile enables `overflow-checks`, and it stays that way.
* Prefer explicit, boring code over clever code. This program is meant to be read by an
  auditor who has never seen it before.
* Every account constraint that carries security weight gets a comment saying which threat it
  addresses, and ideally names the test that covers it.

### TypeScript (SDK)

* **Zero runtime dependencies, by policy.** `@commitonce/solana` has no `dependencies`, only
  `@solana/kit` as a peer dependency, and it stays that way. Hashing uses WebCrypto
  (`crypto.subtle`), which is available in Node 18+, browsers, Deno, Bun and workers. The
  reasons are audit surface, supply-chain risk, and the fact that a wallet, a relayer and an
  offline signer must all be able to use the same pure derivation.
* Adding a runtime dependency requires a discussion in an issue first, and a very good reason.
  A dev dependency is fine; a dependency in the published artifact is not.
* `strict` TypeScript with `noUncheckedIndexedAccess`, `verbatimModuleSyntax` and
  `noUnusedLocals` is enabled in `tsconfig.base.json`. Do not weaken it to make code compile.
* `pnpm --filter @commitonce/solana typecheck` must pass. It is a required CI step.
* Prefer pure functions and explicit error types. `encodeIntent` throwing on `undefined`
  rather than dropping it is intentional and load-bearing — see `docs/SECURITY_MODEL.md` §5.
* Match the surrounding style: 4-space indent, double quotes, trailing commas, 100-column
  lines. There is no Prettier config in the tree today, so the root `format` script would use
  Prettier's defaults and reformat unrelated files; prefer matching by hand, and if you want a
  config, add it in its own commit.

### Shell scripts

* `set -euo pipefail` (or an explicit, documented equivalent) and quote every expansion.
* Scripts must fail loudly. Never let a verification step turn into a silent skip: a check
  that cannot run is a failure, not a pass.
* `scripts/build.sh` verifies `declare_id!` against `deploy-keys/*-keypair.json` after every
  build and exits 1 on mismatch. Do not make that check optional.

### Line endings

`.gitattributes` normalizes text to LF in the repository. Shell scripts, Rust sources, TOML
and TypeScript must not acquire CRLF — a CRLF shebang produces `bad interpreter` on Linux and
a confusing CI failure. If you edit from Windows, check `git diff --stat` for whole-file
changes before committing.

### Do not write repository files with PowerShell redirection

**Use Node, or an editor, to write any file containing non-ASCII characters.** This has now
caused the same corruption twice, so it is a rule rather than a preference.

`Set-Content` and `>` in Windows PowerShell 5.1 default to Windows-1252, not UTF-8. A single
em dash is three bytes in UTF-8 (`E2 80 94`); written through that path it becomes `E2 80 3F` —
the first two bytes followed by a literal `?`. The file is then **not valid UTF-8**, which means
it is unreadable on Linux and binary to git. Worse, repairing it is a trap: restoring the third
byte to `0x94` yields *valid* UTF-8, but as an em dash where the original was an en dash, and in
one case the following character was consumed as well — `2:00–2:59` became `2:00—:59`. Valid <!-- encoding-check: allow-em-dash -->
UTF-8, wrong text.

Two checks now stand in the way, and both were added because they caught this:

- `node scripts/check-encoding.mjs` rejects files that are not valid UTF-8, files with a BOM or
  UTF-16, mojibake, and an em dash adjacent to a digit. It runs as a step in `verify.sh`.
- `node scripts/check-docs.mjs` catches the structural damage that a round-trip tends to leave
  behind, such as a table row detached from its table.

If a file does get mangled, **do not hand-repair the bytes.** Revert it from git and redo the
edit with Node:

```bash
git checkout -- path/to/file
node -e "const fs=require('node:fs');const f='path/to/file';fs.writeFileSync(f,fs.readFileSync(f,'utf8').replaceAll('old','new'),'utf8')"
```

---

## 7. Adding a new error code

Anchor numbers custom errors from 6000 upwards **in enum declaration order**, so the order of
the enum in `programs/commit-once/src/error.rs` is part of the wire contract. Reordering or
removing a variant silently renumbers every code after it.

1. **Append the variant to the end of `CommitOnceError`** in
   `programs/commit-once/src/error.rs`. Never insert it in the middle. Give it a doc comment
   saying what condition triggers it and a `#[msg("...")]` that a caller can act on.
2. **Add it to `COMMIT_ONCE_ERROR_CODES` and `COMMIT_ONCE_ERROR_MESSAGES`** in
   `packages/sdk/src/errors.ts`, with the next code in sequence (6000 + index). The SDK
   enumerates codes so callers do not use magic numbers.
3. **Pin the code in `packages/sdk/test/vectors.test.ts`**, in the "error classification"
   block, which asserts each code against its literal number. That is what catches a
   reordering.
4. **Document it** in `docs/API_REFERENCE.md` (the error table) and in the SDK doc comment.
5. **Test the behaviour, not the message.** The test must assert the observable consequence:
   the receipt was not created, the counter did not move, the lamports did not move. Asserting
   the code is fine as an additional check; asserting the message string is not acceptable.
6. **Say whether the new error is fail-closed.** If a caller can trigger it in a way that
   leaves a receipt behind, or that permanently poisons a key, that is a guarantee-affecting
   change and it belongs in `docs/SECURITY_MODEL.md` §8.

If the new code means "this intent already committed", do not reuse `AlreadyCommitted`. The
SDK's `isAlreadyCommitted` helper is used by callers to treat a retry as a normal outcome;
conflating a different condition with it would change their control flow.

---

## 8. Commit messages

Short and conventional. The subject line is what a reviewer reads first.

```
<scope>: <imperative summary, <= 72 chars>
```

Scopes in use: `program`, `sdk`, `docs`, `scripts`, `ci`, `examples`, `repo`.

```
program: reject durable nonces for finite retention

The receipt for a nonce transaction can be closed while an old signed duplicate is
still executable, which reopens the duplicate window permanently. Inspect the
Instructions sysvar for AdvanceNonceAccount (u32 LE 4) and reject unless
retention_seconds == 0.

Test: durable_nonce_transaction_is_rejected_for_finite_retention
```

Rules:

* Imperative mood, no trailing period, no emoji.
* Body explains **why**, not what — the diff already shows what.
* Name the test that covers the change. If there is no test, the change is incomplete.
* One logical change per commit. A refactor and a behaviour change do not share a commit,
  because then the behavioural diff cannot be reviewed on its own.
* Never write that something is audited, deployed, published or used. It is not, and commit
  messages end up quoted.

---

## 9. Pull requests

Before opening one, confirm:

- [ ] `bash verify.sh` passes, and you have read its output rather than just its exit code.
- [ ] Behavioural changes come with a test asserting observable onchain state.
- [ ] Bug fixes come with a regression test that failed before the fix.
- [ ] `docs/` is updated in the same commit as the behaviour change.
- [ ] Golden vectors are updated in **both** `programs/commit-once/tests/wire_format.rs` and
      `packages/sdk/test/vectors.test.ts` if the derivation changed.
- [ ] `cargo fmt --all --check` and `cargo clippy --workspace --all-targets` are clean.
- [ ] The SDK still has zero runtime dependencies.
- [ ] Nothing claims an audit, a mainnet deployment, an npm publication, or a user.
- [ ] The guarantee is still described as at-most-once within a retention window.

State in the PR description what you ran and what you observed. "Tests pass" is not a
description; the output of the tests is.

---

## 10. Reporting security issues

Do **not** open a public issue for a security finding. Read
[`SECURITY.md`](SECURITY.md) first: it defines the scope, the severity guide, what to include
in a report, and the intended guarantee so you can judge whether what you found actually
breaks it.
