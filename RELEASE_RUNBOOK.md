# Release runbook

How to build, verify, deploy and roll back CommitOnce. Written to be followed by someone who
has not worked on this repository before, and to fail loudly rather than silently.

> **Read this first.** CommitOnce is **unaudited**. Nothing here authorises a mainnet
> deployment of code that has not been reviewed. The mainnet section states the decisions
> that must be made *before* deploying, not after.

---

## 0. Environment

Rust and the Solana toolchain run under **WSL2 Ubuntu**, not Windows natively. Two
environment facts cause most setup failures, so they are handled explicitly by every script:

| Fact | Why it matters |
| --- | --- |
| WSL's `HOME` is unset in this environment | Every script exports `HOME=/home/dell2u`. Without it, `cargo` and `solana` cannot find their config and fail with confusing errors. |
| The repository lives on a Windows drive | The Solana linker is slow on `/mnt/c`. Builds use `CARGO_TARGET_DIR=/home/dell2u/cot-target` on ext4. |

Verified toolchain versions (see [`EVIDENCE.md`](EVIDENCE.md) §1):

```
solana-cli 4.2.2      anchor-cli 1.2.0      cargo-build-sbf 4.1.0
platform-tools v1.54  Node.js 24.20.0       pnpm 11.24.0
```

---

## 1. Build

```bash
bash scripts/build.sh
```

What it does, in order:

1. Pins `HOME`, `PATH` (Solana + Cargo), and `CARGO_TARGET_DIR`.
2. Force-copies `deploy-keys/*.json` into **both** `$CARGO_TARGET_DIR/deploy/` and
   `<repo>/target/deploy/`.
3. Runs `anchor build --arch "${SBPF_ARCH:-v2}"`.
4. Copies the `.so` files and IDLs back into `<repo>/target/`.
5. **Verifies every `declare_id!` against its `deploy-keys/*.json` pubkey and exits 1 on
   mismatch.**

### Two traps this script exists to prevent

**`anchor keys sync` is deliberately not run.** Anchor's deploy directory follows
`CARGO_TARGET_DIR`, not the repository, so a stale keypair in the wrong directory caused
`anchor keys sync` to rewrite `declare_id!` and `Anchor.toml` to unrelated addresses —
repeatedly. The script instead places the keypairs deterministically and verifies the result
instead of trusting a tool to repair it.

**SBPFv2, not the Anchor default.** `anchor build` defaults to `--arch v3`, producing
`e_flags = 0x3`. LiteSVM 0.10.0 rejects v3 ELFs with `Instruction(InvalidAccountData)`, so
a default build yields a program the test suite cannot execute. Confirm the target with:

```bash
readelf -h target/deploy/commit_once.so | grep Flags    # expect: Flags: 0x2
```

Override with `SBPF_ARCH=v3 bash scripts/build.sh` only if you have verified that your
runtime accepts v3.

### Expected artifacts

| File | Size | SHA-256 |
| --- | --- | --- |
| `target/deploy/commit_once.so` | 148,640 B | `af31807802e6f82e917e93e4f42172c23bbdda0dc1b2d609281d045364f6df45` |
| `target/deploy/demo_counter.so` | 158,432 B | `dc524ce0d166eaf5305951fc41e97004c4c0b37ffee00c1c84c3f5f37df583c7` |

Sizes may legitimately drift between compiler versions. Hashes will differ if you change
source. Treat them as a drift detector, not as a contract.

---

## 2. Verify

```bash
bash verify.sh          # everything, with a PASS/FAIL summary
bash scripts/test.sh    # Rust suite only: expect 40 passed, exit 0
```

The Rust tests execute the **real compiled SBF artifact** through LiteSVM. They will fail
with `InvalidAccountData` if you built with the wrong SBPF target — that error almost always
means v3, not a program bug.

To see the overhead table:

```bash
bash scripts/test.sh --test benchmarks -- --nocapture
```

SDK:

```bash
cd packages/sdk
pnpm run typecheck
pnpm run build      # dist/esm + dist/cjs + dist/types
pnpm test           # expect 48 passed
```

---

## 3. Deploy to devnet

Devnet is the safe rehearsal. Both programs are already live there (see `EVIDENCE.md` §3).

```bash
export HOME=/home/dell2u
solana config set --url https://api.devnet.solana.com
solana balance            # needs ~1.5 SOL for both programs

cd /mnt/c/Users/Dell2u/Downloads/commitonce
solana program deploy target/deploy/commit_once.so \
  --program-id deploy-keys/commit_once-keypair.json \
  --url https://api.devnet.solana.com

solana program deploy target/deploy/demo_counter.so \
  --program-id deploy-keys/demo_counter-keypair.json \
  --url https://api.devnet.solana.com
```

Verify, rather than assuming the deploy worked:

```bash
solana program show CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB --url devnet
solana program show EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5 --url devnet
```

Check that `Owner` is `BPFLoaderUpgradeab1e11111111111111111111111` and that `Data Length`
matches the `.so` on disk.

### Redeploying over an existing program

```bash
solana program deploy target/deploy/commit_once.so \
  --program-id deploy-keys/commit_once-keypair.json \
  --url https://api.devnet.solana.com \
  --upgrade-authority ~/.config/solana/id.json
```

**Receipts survive a program upgrade.** A redeploy does not clear existing receipt PDAs, so
an upgraded program will still see receipts written by the previous version. That is why the
receipt carries an explicit `version` field and why the handler rejects an unrecognised
version with `UnsupportedReceiptVersion` rather than guessing. If you change the layout,
**bump `RECEIPT_VERSION`** — do not silently reinterpret old bytes.

---

## 4. Deploy to mainnet

**Not done, and not to be done casually.** Cost from the real devnet deployment is
1.48276056 SOL for both program accounts; budget ~2.5–3 SOL with headroom.

### Three decisions required before deploying

1. **Upgradeable or immutable?**
   * Upgradeable — you can fix bugs. Requires a live upgrade authority, which is a real
     trust assumption for users.
   * Immutable (`solana program set-upgrade-authority <id> --final`) — a stronger claim, and
     a bug becomes permanent.
   This has no default answer. Decide, and state the decision publicly.
2. **Who holds the upgrade authority?** For anything holding value, a multisig rather than a
   single hot key. Squads can hold it.
3. **Audit timing.** Deploying unaudited code means users are exposed to unreviewed logic.
   If you deploy anyway, say so plainly in the UI and the docs — which is exactly what this
   repository already does.

### Procedure

```bash
solana config set --url https://api.mainnet-beta.solana.com
bash scripts/build.sh          # verify IDs first; it exits 1 on mismatch
solana program deploy target/deploy/commit_once.so \
  --program-id deploy-keys/commit_once-keypair.json \
  --url https://api.mainnet-beta.solana.com
solana program show CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB \
  --url https://api.mainnet-beta.solana.com
```

Then verify the rent figure against the live cluster, because it depends on activated
features rather than on a constant:

```bash
solana rent 202 --url https://api.mainnet-beta.solana.com
# expect ~1.6764 SOL/1000 ... verify the exact lamport figure before publishing it
```

If the live figure differs from 1,676,400 lamports, the constant in
`programs/commit-once/tests/common/mod.rs` and every document quoting it must be updated.
The `solana-rent` Rust crate is known to be stale (effective 6960 lamports/byte, 37% too
high), which is why the harness overrides the sysvar.

---

## 5. Rollback

### Program

An upgradeable program can be reverted by redeploying a previous `.so`:

```bash
solana program deploy ./commit_once-previous.so \
  --program-id deploy-keys/commit_once-keypair.json \
  --url <cluster>
```

**Keep the previous `.so`.** There is no on-chain version history to restore from — if you
overwrite the artifact without keeping a copy, you cannot go back.

If the program is immutable, there is no rollback. That is the point of choosing immutable,
and it is why the choice must be deliberate.

### Receipts

Receipts are user-owned PDAs and are **not** affected by a program upgrade. Do not attempt
to mass-close them: they are the evidence that a given intent committed, and closing one
reopens that key. Users close their own receipts through `close_receipt` when the retention
has elapsed and they want the deposit back.

### SDK

`@commitonce/solana` follows semver. The hashing and PDA derivation are the compatibility
surface: changing either invalidates every existing receipt derivation. If a change there is
ever unavoidable, it must be a major version with a documented migration, and the golden
vectors in **both** `programs/commit-once/tests/wire_format.rs` and
`packages/sdk/test/vectors.test.ts` must be updated together.

---

## 6. Pre-release checklist

- [ ] `bash scripts/build.sh` exits 0 and reports matching program IDs.
- [ ] `readelf -h target/deploy/commit_once.so | grep Flags` shows `0x2`.
- [ ] `bash scripts/test.sh` → 40 passed, exit 0.
- [ ] `pnpm --filter @commitonce/solana test` → 48 passed.
- [ ] `pnpm --filter @commitonce/solana run typecheck` → clean.
- [ ] `pnpm run build` in `packages/sdk` emits `dist/esm`, `dist/cjs`, `dist/types`.
- [ ] Both module systems resolve: `require('@commitonce/solana')` and
      `import('@commitonce/solana')`.
- [ ] `RECEIPT_VERSION` was bumped if the receipt layout changed.
- [ ] Golden vectors updated in **both** languages if the derivation changed.
- [ ] `EVIDENCE.md` updated with what is now verified — and what still is not.
- [ ] `README.md` status table reflects reality.
- [ ] A previous `.so` is archived for rollback.
- [ ] If deploying to mainnet: audit status, upgrade-authority decision, and the public
      disclosure of that status are all settled.

---

## 7. Failure modes and what they mean

| Symptom | Almost certainly |
| --- | --- |
| `Instruction(InvalidAccountData)` when loading the program in tests | Built SBPFv3. Rebuild with `SBPF_ARCH=v2`. |
| `declare_id!` mismatch on build | `deploy-keys/*.json` does not match the source. Do **not** run `anchor keys sync`; reconcile the keypair instead. |
| `BlockhashNotFound` in tests | LiteSVM accepts only one recent blockhash. Rebuild the transaction against the current one, or `expire_blockhash()` between attempts. |
| `AlreadyProcessed` where `AlreadyCommitted` was expected | The test sent byte-identical transactions, so runtime dedup fired first. Rebuild properly — change the blockhash or the priority fee. |
| `NotEnoughSigners` | The instruction requires a signer the harness did not add. |
| Rent assertion off by exactly 5000 lamports | That is the transaction fee, which the runtime charges even on failure. |
| Test count changed | Update `EVIDENCE.md` §4, `README.md`, and this runbook together. The counts are quoted in several places. |
