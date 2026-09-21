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
# `anchor build` defaults to `--arch v3`, but the resulting ELF carries
# `e_flags = 0x3` (CPU version 3), which LiteSVM 0.10.0 cannot verify: `add_program`
# rejects it with `Instruction(InvalidAccountData)`. LiteSVM is Anchor 1.2.0's own
# recommended test path, so building for v3 would mean shipping a program that the
# project's test suite cannot execute.
#
# SBPFv2 is accepted by LiteSVM, by devnet and by mainnet. The cost of choosing v2 is a
# marginal difference in compute units and code size; the cost of choosing v3 is losing
# the ability to run the program in a local test harness at all. Override with
# SBPF_ARCH=v3 once the test harness supports it.
# ---------------------------------------------------------------------------
ARCH="${SBPF_ARCH:-v2}"

echo "=== anchor build (sbpf ${ARCH}) ==="
anchor build --arch "$ARCH" "$@"

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
