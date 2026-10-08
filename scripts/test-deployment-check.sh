#!/usr/bin/env bash
# Exercise the deployment verifier with synthetic CLI dumps, without contacting a cluster.
# The real built artifacts are read only; every generated file lives under mktemp.
set -euo pipefail

COMMIT_ONCE_TEST_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export COMMIT_ONCE_TEST_REPO
COMMIT_ONCE_TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$COMMIT_ONCE_TEST_TMP"' EXIT

for name in commit_once demo_counter; do
    test -s "$COMMIT_ONCE_TEST_REPO/target/deploy/$name.so"
done

solana() {
    local name slot source destination
    case "$3" in
        CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB) name=commit_once; slot=503174994 ;;
        EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5) name=demo_counter; slot=503175063 ;;
        *) return 1 ;;
    esac
    case "$1 $2" in
        'program show')
            printf 'Last Deployed In Slot: %s\nAuthority: 25TUohqYd5b6f97wc5CjMwj89ZVL8oX81nhkWVHimYpY\n' "$slot"
            ;;
        'program dump')
            source="$COMMIT_ONCE_TEST_REPO/target/deploy/$name.so"
            destination="$4"
            case "$COMMIT_ONCE_TEST_MODE" in
                zero) cp "$source" "$destination"; printf '\000\000' >> "$destination" ;;
                nonzero) cp "$source" "$destination"; printf '\000\001' >> "$destination" ;;
                truncated) head -c 8 "$source" > "$destination" ;;
                changed) printf '\001' > "$destination"; tail -c +2 "$source" >> "$destination" ;;
            esac
            ;;
        *) return 1 ;;
    esac
}
export -f solana

for mode in zero nonzero truncated changed; do
    export COMMIT_ONCE_TEST_MODE="$mode"
    result=0
    bash "$COMMIT_ONCE_TEST_REPO/scripts/verify-deployment.sh" mock://offline \
        > "$COMMIT_ONCE_TEST_TMP/$mode.log" 2>&1 || result=$?
    if [ "$mode" = zero ]; then
        test "$result" -eq 0
        grep -q 'DEPLOYMENT MATCHES THE REPOSITORY' "$COMMIT_ONCE_TEST_TMP/$mode.log"
    else
        if [ "$result" -eq 0 ]; then
            echo "FAIL: $mode dump was accepted as identical"
            exit 1
        fi
        case "$mode" in
            nonzero) grep -q 'non-zero trailing bytes' "$COMMIT_ONCE_TEST_TMP/$mode.log" ;;
            truncated) grep -q 'SMALLER than the artifact' "$COMMIT_ONCE_TEST_TMP/$mode.log" ;;
            changed) grep -q 'deployed bytes differ' "$COMMIT_ONCE_TEST_TMP/$mode.log" ;;
        esac
    fi
    echo "ok: $mode dump has the expected verification result (synthetic CLI)"
done
echo 'DEPLOYMENT VERIFIER REGRESSION CHECK PASSED'
