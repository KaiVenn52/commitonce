#!/usr/bin/env bash
# Exercise the environment block in scripts/build.sh on both branches.
#
# The maintainer machine always takes the first branch, so the portable one — the one a judge,
# a contributor or CI takes — would otherwise never be executed by anything. That is how the
# hardcoded HOME survived: `verify.sh` carefully checked whether /home/dell2u exists and then
# called a script that overrode the decision, and nothing ran the other path to notice.
#
# This does not build anything. It extracts the environment block, runs it twice with the
# toolchain home pointed at a path that exists and one that does not, and checks that the
# resulting CARGO_TARGET_DIR is inside the repository in the second case.
#
# Run: bash scripts/check-script-env.sh
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO" || exit 1

failures=0
check() {
    local label="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        echo "  ok      $label"
    else
        echo "  FAIL    $label"
        echo "            expected: $expected"
        echo "            actual:   $actual"
        failures=$((failures + 1))
    fi
}

# The environment block, taken from the real script so it cannot drift from what ships.
BLOCK="$(sed -n '/^# Environment\./,/^fi$/p' scripts/build.sh)"
if [ -z "$BLOCK" ]; then
    echo "  FAIL    could not extract the environment block from scripts/build.sh"
    exit 1
fi

run_block() {
    # Runs the extracted block in a subshell with a chosen toolchain home, then reports the two
    # variables it decided.
    (
        set -uo pipefail
        REPO="$REPO"
        unset CARGO_TARGET_DIR
        export HOME="${PROBE_HOME:-$HOME}"
        eval "$BLOCK"
        printf '%s\n%s\n' "$CARGO_TARGET_DIR" "$HOME"
    )
}

echo "=== the environment block in scripts/build.sh ==="

# Branch 2: a toolchain home that does not exist. This is the path every other machine takes.
PORTABLE="$(PROBE_HOME=/tmp COMMIT_ONCE_TOOLCHAIN_HOME=/nonexistent-toolchain-home run_block)"
PORTABLE_TARGET="$(printf '%s' "$PORTABLE" | head -1)"
PORTABLE_HOME="$(printf '%s' "$PORTABLE" | tail -1)"

case "$PORTABLE_TARGET" in
    "$REPO"/*) check "portable branch: target is inside the repository" "yes" "yes" ;;
    *) check "portable branch: target is inside the repository" "yes" "no ($PORTABLE_TARGET)" ;;
esac
check "portable branch: HOME is left alone" "/tmp" "$PORTABLE_HOME"

# Branch 1: the real maintainer layout, when it is present on this machine.
if [ -d /home/dell2u/solana-current/bin ]; then
    MAINTAINER="$(PROBE_HOME=/tmp run_block)"
    MAINTAINER_TARGET="$(printf '%s' "$MAINTAINER" | head -1)"
    check "maintainer branch: target is the ext4 cache" "/home/dell2u/cot-target" "$MAINTAINER_TARGET"
else
    echo "  skip    maintainer branch (this machine has no /home/dell2u/solana-current/bin)"
fi

echo
if [ "$failures" -eq 0 ]; then
    echo "SCRIPT ENV CHECK PASSED"
    exit 0
fi
echo "SCRIPT ENV CHECK FAILED ($failures)"
exit 1
