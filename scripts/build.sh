#!/usr/bin/env bash
# Build the CommitOnce programs to SBF and generate IDLs.
#
# CARGO_TARGET_DIR points at WSL-native ext4 storage because the repository itself lives
# on a Windows drive: only the small .so / IDL artifacts need to land in the workspace,
# while the multi-gigabyte incremental build cache stays on Linux storage.
set -euo pipefail

export HOME=/home/dell2u
export PATH="/home/dell2u/solana-current/bin:$HOME/.cargo/bin:$PATH"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-/home/dell2u/cot-target}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# ---------------------------------------------------------------------------
# Program IDs
#
# The committed keypairs in deploy-keys/ are the single source of truth for program IDs.
# They are FORCE-copied into anchor's deploy directory, because `anchor build` compares
# `declare_id!` against the keypair it finds there and refuses to build on a mismatch.
# A stale or auto-generated keypair left in that directory would therefore either break
# the build or silently rewrite the program ID to an address nobody controls, so
# `cp -n` is not safe here.
#
# Note that anchor's deploy directory follows CARGO_TARGET_DIR, so it is
# $CARGO_TARGET_DIR/deploy rather than <repo>/target/deploy. Both are populated: the
# workspace copy exists so the artifacts and keypairs are visible from a Windows checkout.
# ---------------------------------------------------------------------------
mkdir -p "$CARGO_TARGET_DIR/deploy" target/deploy
for k in deploy-keys/*-keypair.json; do
  [ -e "$k" ] || continue
  cp -f "$k" "$CARGO_TARGET_DIR/deploy/$(basename "$k")"
  cp -f "$k" "target/deploy/$(basename "$k")"
done

# ---------------------------------------------------------------------------
# SBPF architecture
#
# v3, which is also `anchor build`'s default. v2 was used for most of the project's life, for a
# reason that turned out to be wrong twice over, and both corrections are worth keeping.
#
# **First correction: a real Agave validator rejects a v2 artifact.** Running the program against
# `solana-test-validator` 4.2.2 — the actual runtime, not a harness — failed at deploy with
#
#     Detected sbpf_version required by the executable which are not enabled
#     Program BPFLoaderUpgradeab1e11111111111111111111111111111111 failed
#
# while the same validator accepted v3. A fresh validator activates every feature the binary
# knows about, so it runs ahead of devnet. That is why the v2 devnet deployment worked and why
# this was invisible until the program was run somewhere real. The exposure was the *deploy*
# path: an already-deployed program keeps running, but a future upgrade deploy of a v2 artifact
# would be rejected once that feature activated on the target cluster.
#
# **Second correction: the blocker was the toolchain pin, not a dependency chain.** v2 existed
# because LiteSVM 0.10.0 could not verify a v3 ELF — `add_program` rejected it with
# `Instruction(InvalidAccountData)` — and the test suite is the only thing that executes the
# compiled artifact. LiteSVM 0.16.0 accepts both. I first recorded the upgrade as blocked by
# litesvm 0.16's dependency tree, and that was wrong: the tree resolves fine once the dev-deps
# are pinned to litesvm's own requirements (it deliberately mixes 3.x and 4.x), and the
# `solana-syscalls` build failure came from this repository pinning **Rust 1.89.0** in
# `rust-toolchain.toml`. On the newer toolchain that crate compiles without any flags.
#
# So the pin moved to 1.98.0, the dev-dependencies were matched to litesvm 0.16's own pins, and
# v3 is now what ships. `SBPF_ARCH=v2` still builds the old artifact.
#
# If the toolchain pin is ever moved back, the test suite stops building — that is the load-
# bearing part of this change, not the arch flag.
# ---------------------------------------------------------------------------
ARCH="${SBPF_ARCH:-v3}"

echo "=== anchor build (sbpf ${ARCH}) ==="
anchor build --arch "$ARCH" "$@"

# ---------------------------------------------------------------------------
# The non-Anchor test program.
#
# It lives in `programs-native/` and is `exclude`d from the workspace because `anchor build`
# refuses to build a member without an IDL, and a program that is not written with Anchor has
# none to give it. So it is built here, directly, and its artifact lands in the same deploy
# directory as the others — `tests/native_cpi.rs` loads it from there at an arbitrary address.
#
# It is never deployed, so it has no keypair and no `declare_id!`, and the program-id check
# below skips it by construction (that loop walks `deploy-keys/*-keypair.json`).
# ---------------------------------------------------------------------------
echo "=== cargo-build-sbf: native-guard (sbpf ${ARCH}) ==="
cargo-build-sbf --manifest-path programs-native/native-guard/Cargo.toml --arch "$ARCH"

# ---------------------------------------------------------------------------
# Copy the build outputs back into the workspace so they are inspectable without knowing
# where CARGO_TARGET_DIR points.
# ---------------------------------------------------------------------------
mkdir -p target/deploy target/idl target/types
cp -f "$CARGO_TARGET_DIR"/deploy/*.so target/deploy/ 2>/dev/null || true
cp -f "$CARGO_TARGET_DIR"/idl/*.json target/idl/ 2>/dev/null || true
cp -f "$CARGO_TARGET_DIR"/types/*.ts target/types/ 2>/dev/null || true

# ---------------------------------------------------------------------------
# Verify that what was compiled matches the committed keypairs. If this fails, the
# program would deploy at an address that does not match its `declare_id!` and every
# instruction would fail at runtime.
# ---------------------------------------------------------------------------
echo "=== verify program ids ==="
status=0
for k in deploy-keys/*-keypair.json; do
  name="$(basename "$k" -keypair.json)"
  crate="${name//_/-}"
  want="$(solana-keygen pubkey "$k")"
  src="programs/${crate}/src/lib.rs"
  got="$(sed -n 's/.*declare_id!("\([^"]*\)").*/\1/p' "$src" | head -1)"
  if [ "$want" != "$got" ]; then
    echo "  MISMATCH ${name}: keypair=${want} declare_id!=${got}" >&2
    status=1
  else
    echo "  ok ${name} = ${got}"
  fi
done
if [ "$status" -ne 0 ]; then
  echo "FATAL: deploy-keys/ and declare_id! disagree; refusing to report success" >&2
  exit 1
fi

echo "=== artifacts ==="
ls -l target/deploy/*.so 2>/dev/null || echo "  (no .so files found)"
ls -l target/idl/*.json 2>/dev/null || echo "  (no IDL files found)"

echo "BUILD_DONE"
