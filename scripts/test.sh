#!/usr/bin/env bash
# Run the CommitOnce test suites.
#
# The Rust integration tests execute the real compiled SBF program through LiteSVM. They
# locate the .so files via COMMIT_ONCE_DEPLOY_DIR, falling back to <repo>/target/deploy.
# Because this project sets CARGO_TARGET_DIR to keep the multi-gigabyte build cache off
# the Windows drive, anchor writes its artifacts to $CARGO_TARGET_DIR/deploy, so that is
# the default here.
set -euo pipefail

export HOME=/home/dell2u
export PATH="/home/dell2u/solana-current/bin:$HOME/.cargo/bin:$PATH"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-/home/dell2u/cot-target}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

export COMMIT_ONCE_DEPLOY_DIR="${COMMIT_ONCE_DEPLOY_DIR:-$CARGO_TARGET_DIR/deploy}"

if [ ! -f "$COMMIT_ONCE_DEPLOY_DIR/commit_once.so" ]; then
  echo "No compiled program found in $COMMIT_ONCE_DEPLOY_DIR" >&2
  echo "Build the programs first:  bash scripts/build.sh" >&2
  exit 1
fi

echo "=== rust program tests (LiteSVM, real SBF) ==="
cargo test --workspace "$@"
