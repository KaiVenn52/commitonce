#!/usr/bin/env bash
# Run the CommitOnce test suites.
#
# The Rust integration tests execute the real compiled SBF program through LiteSVM. They
# locate the .so files via COMMIT_ONCE_DEPLOY_DIR, falling back to <repo>/target/deploy.
# Because this project sets CARGO_TARGET_DIR to keep the multi-gigabyte build cache off
# the Windows drive, anchor writes its artifacts to $CARGO_TARGET_DIR/deploy, so that is
# the default here.
set -euo pipefail

# Resolve the repository root *before* the environment block, because the portable
# CARGO_TARGET_DIR default is relative to it and not to the caller's working directory.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---------------------------------------------------------------------------
# Environment.
#
# These three lines used to force HOME=/home/dell2u and a WSL-specific PATH, which was correct
# on the machine this was written on and wrong everywhere else. A reader who cloned the
# repository and ran `bash verify.sh` got a confusing toolchain failure, because `verify.sh`
# carefully checks whether that home exists before using it — and then called this script,
# which overrode the decision back.
#
# The rule now matches `verify.sh`: use the maintainer layout only when it is actually there.
# On any other machine the ambient HOME and PATH are already right, which is what a judge, a
# contributor or CI has.
# ---------------------------------------------------------------------------
if [ -d /home/dell2u/solana-current/bin ]; then
    export HOME=/home/dell2u
    export PATH="/home/dell2u/solana-current/bin:$HOME/.cargo/bin:$PATH"
    # WSL-native storage: the repository lives on a Windows drive, so only the small .so and
    # IDL artifacts land in the workspace while the multi-gigabyte build cache stays on Linux
    # storage. Anywhere else the workspace copy is the sensible default.
    export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-/home/dell2u/cot-target}"
else
    export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$REPO/target}"
fi

cd "$REPO"

export COMMIT_ONCE_DEPLOY_DIR="${COMMIT_ONCE_DEPLOY_DIR:-$CARGO_TARGET_DIR/deploy}"

if [ ! -f "$COMMIT_ONCE_DEPLOY_DIR/commit_once.so" ]; then
  echo "No compiled program found in $COMMIT_ONCE_DEPLOY_DIR" >&2
  echo "Build the programs first:  bash scripts/build.sh" >&2
  exit 1
fi

echo "=== rust program tests (LiteSVM, real SBF) ==="
cargo test --workspace "$@"
