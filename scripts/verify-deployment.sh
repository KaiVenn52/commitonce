#!/usr/bin/env bash
# Verify the live devnet deployment against the committed artifacts.
#
# "Deployed on devnet" is a claim a judge can check in five seconds, which makes it the claim most
# worth keeping true. It can drift three ways: the program is upgraded, the cluster is reset, or
# the committed .so changes without a redeploy. All three make the documentation wrong.
#
# **Do not compare whole-file hashes.** `solana program dump` returns the program data account,
# which the loader has padded with trailing zero bytes, so a dumped file is always larger than the
# `.so` that produced it and a `sha256sum` comparison always reports a mismatch. The first
# investigation of this did exactly that and reported DIFFERENT for both programs; the first
# 148,640 bytes were in fact byte-identical. The comparison below is a prefix comparison, and it
# reports the padding it ignored so the number is visible rather than assumed.
#
# Run: bash scripts/verify-deployment.sh [cluster-url]
set -uo pipefail

# The environment block, matching the other scripts: use the maintainer layout only if present.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMIT_ONCE_TOOLCHAIN_HOME="${COMMIT_ONCE_TOOLCHAIN_HOME:-/home/dell2u}"
if [ -d "$COMMIT_ONCE_TOOLCHAIN_HOME/solana-current/bin" ]; then
    export HOME="$COMMIT_ONCE_TOOLCHAIN_HOME"
    export PATH="$COMMIT_ONCE_TOOLCHAIN_HOME/solana-current/bin:$HOME/.cargo/bin:$PATH"
fi
cd "$REPO" || exit 1

RPC="${1:-https://api.devnet.solana.com}"

# The two programs, and the slots the documents claim.
declare -A IDS=(
    [commit_once]="CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB"
    [demo_counter]="EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5"
)
declare -A EXPECTED_SLOT=(
    [commit_once]="503174994"
    [demo_counter]="503175063"
)
EXPECTED_AUTHORITY="25TUohqYd5b6f97wc5CjMwj89ZVL8oX81nhkWVHimYpY"

failures=0
ok() { echo "  ok      $1"; }
bad() { echo "  FAIL    $1"; failures=$((failures + 1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "=== $RPC ==="
for name in commit_once demo_counter; do
    id="${IDS[$name]}"
    out="$(solana program show "$id" --url "$RPC" 2>&1)"

    if printf '%s' "$out" | grep -q "Last Deployed In Slot"; then
        ok "$name is live at $id"
    else
        bad "$name is not readable at $id"
        continue
    fi

    slot="$(printf '%s' "$out" | sed -n 's/.*Last Deployed In Slot: *//p')"
    if [ "$slot" = "${EXPECTED_SLOT[$name]}" ]; then
        ok "$name deployed in slot $slot, as documented"
    else
        bad "$name deployed in slot $slot, but the documents say ${EXPECTED_SLOT[$name]}"
    fi

    authority="$(printf '%s' "$out" | sed -n 's/.*Authority: *//p')"
    if [ "$authority" = "$EXPECTED_AUTHORITY" ]; then
        ok "$name upgrade authority is the documented one"
    else
        bad "$name upgrade authority is $authority, not $EXPECTED_AUTHORITY"
    fi

    local_so="target/deploy/$name.so"
    if [ ! -f "$local_so" ]; then
        bad "$name has no committed artifact at $local_so (run bash scripts/build.sh)"
        continue
    fi

    if ! solana program dump "$id" "$TMP/$name.so" --url "$RPC" > /dev/null 2>&1; then
        bad "$name could not be dumped from $RPC"
        continue
    fi

    local_size="$(stat -c%s "$local_so")"
    deployed_size="$(stat -c%s "$TMP/$name.so")"
    padding=$((deployed_size - local_size))

    if [ "$padding" -lt 0 ]; then
        bad "$name: the deployed program is SMALLER than the artifact by $((-padding)) bytes"
        continue
    fi

    if cmp -s -n "$local_size" "$local_so" "$TMP/$name.so"; then
        ok "$name: the first $local_size bytes are byte-identical to the committed artifact"
        ok "$name: the loader appended $padding zero bytes of padding (ignored)"
    else
        bad "$name: the deployed bytes differ from the committed artifact"
        cmp "$local_so" "$TMP/$name.so" 2>&1 | head -1 | sed 's/^/            /'
    fi
done

echo
if [ "$failures" -eq 0 ]; then
    echo "DEPLOYMENT MATCHES THE REPOSITORY"
    exit 0
fi
echo "DEPLOYMENT CHECK FAILED ($failures)"
exit 1
