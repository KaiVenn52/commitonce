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
# v2, and the reason is a chain rather than a preference.
#
# **A real Agave validator rejects a v2 artifact.** Running the program against
# `solana-test-validator` 4.2.2 — not a harness, the actual runtime — fails at deploy with:
#
#     Detected sbpf_version required by the executable which are not enabled
#     Program BPFLoaderUpgradeab1e11111111111111111111111111111111 failed
#
# and the same validator accepts a v3 artifact. A fresh validator activates every feature the
# binary knows about, so it runs ahead of devnet; that is why the v2 deployment on devnet works
# and why this was invisible until the program was run somewhere real.
#
# **The harness limitation that forced v2 is gone.** v2 was chosen because LiteSVM 0.10.0 could
# not verify a v3 ELF (`e_flags = 0x3`) — `add_program` rejected it with
# `Instruction(InvalidAccountData)` — and the test suite is the only thing that executes the
# compiled artifact. LiteSVM **0.16.0 accepts both v2 and v3**, verified directly. So the
# capability is there.
#
# **What blocks the switch is a dependency chain, not a capability.** Moving to 0.16.0 forces
# `solana-hash ~4.5.0`, which conflicts with `solana-address-lookup-table-interface 4.0.0`
# (`solana-hash ^4.6.0`); dropping that dev-dependency to 3.0.0 resolves the conflict, but
# litesvm 0.16's tree then pulls `solana-syscalls 4.2.2`, which **does not compile for the host
# at all** with stable Rust:
#
#     error[E0658]: use of unstable library feature `maybe_uninit_write_slice`
#     --> solana-syscalls-4.2.2/src/lib.rs:2531:29
#
# That is still unstable on Rust 1.98.0, so this is not a `rustup update` away. It is a real
# piece of work and it is the next thing to do here.
#
# **What this means today.** v2 is loadable on devnet (verified by running against it) and its
# deploy succeeded there. The exposure is that a *future upgrade deploy* would be rejected once
# the feature that gates v2 activates on the target cluster. A program already deployed keeps
# running; it is the deploy path that breaks. `SBPF_ARCH=v3` builds the artifact a
# current-feature-set runtime wants, for testing that claim directly.
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
