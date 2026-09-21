#!/usr/bin/env bash
#
# Set up devnet state for the guarded SPL transfer example, so it can be run for real.
#
# `index.ts` needs a mint the authority actually holds, and a recipient. This creates both:
# a fresh 6-decimal mint, the authority's associated token account, and 1,000 tokens in it.
# It then prints the exact environment to export.
#
#   bash examples/spl-transfer/setup-devnet.sh
#   # then copy the exported lines into your shell and run index.ts
#
# Why a shell script and not TypeScript: `spl-token` already does this correctly, and
# reimplementing mint creation in JavaScript would be more code with more ways to be wrong.
# The point of the example is the *guard*, not the token plumbing.
#
# Run it with bash. It is not POSIX sh.

set -euo pipefail

# This project's Solana toolchain lives under WSL2, where HOME must be set explicitly.
if [ -d /home/dell2u ]; then
    export HOME=/home/dell2u
fi
export PATH="/home/dell2u/solana-current/bin:$HOME/.cargo/bin:$PATH"

RPC_URL="${RPC_URL:-https://api.devnet.solana.com}"
PAYER_KEYPAIR="${PAYER_KEYPAIR:-$HOME/.config/solana/id.json}"
DECIMALS="${DECIMALS:-6}"

# The amount minted, in whole tokens. The example transfers far less than this; the headroom
# is so a re-run with a new order id does not need the mint topped up.
MINT_WHOLE_TOKENS="${MINT_WHOLE_TOKENS:-1000}"

# Where the mint keypair is kept. Outside the repository on purpose: a mint keypair is a
# throwaway devnet secret and must never be committed.
MINT_KEYPAIR="${MINT_KEYPAIR:-$HOME/.cache/commitonce/spl-example-mint.json}"

die() { echo "setup-devnet: $*" >&2; exit 1; }

command -v spl-token >/dev/null 2>&1 || die "spl-token is not on PATH. It ships with the Solana CLI."
command -v solana-keygen >/dev/null 2>&1 || die "solana-keygen is not on PATH."
[ -f "$PAYER_KEYPAIR" ] || die "no keypair at $PAYER_KEYPAIR. Set PAYER_KEYPAIR to a funded devnet key."

AUTHORITY="$(solana-keygen pubkey "$PAYER_KEYPAIR")"
BALANCE="$(solana balance "$AUTHORITY" --url "$RPC_URL" | awk '{print $1}')"

echo "CommitOnce — devnet setup for examples/spl-transfer"
echo "  rpc         $RPC_URL"
echo "  authority   $AUTHORITY"
echo "  balance     $BALANCE SOL"
echo

# Creating a mint costs rent for the mint account plus a fee; creating the ATA costs rent for
# the token account. 0.01 SOL covers both with room to spare, and saying so beats letting the
# user discover it as a confusing failure halfway through.
if awk "BEGIN {exit !($BALANCE < 0.01)}"; then
    die "$AUTHORITY holds $BALANCE SOL, which is not enough. Run: solana airdrop 1 --url $RPC_URL"
fi

mkdir -p "$(dirname "$MINT_KEYPAIR")"

echo "1/3  creating a $DECIMALS-decimal mint"
if [ -f "$MINT_KEYPAIR" ]; then
    MINT="$(solana-keygen pubkey "$MINT_KEYPAIR")"
    if spl-token display "$MINT" --url "$RPC_URL" >/dev/null 2>&1; then
        echo "     reusing the existing mint at $MINT_KEYPAIR"
    else
        echo "     the saved mint keypair has no account on devnet; creating it"
        spl-token create-token "$MINT_KEYPAIR" --decimals "$DECIMALS" \
            --url "$RPC_URL" --fee-payer "$PAYER_KEYPAIR" >/dev/null
    fi
else
    solana-keygen new --no-bip39-passphrase --silent --force --outfile "$MINT_KEYPAIR"
    MINT="$(solana-keygen pubkey "$MINT_KEYPAIR")"
    spl-token create-token "$MINT_KEYPAIR" --decimals "$DECIMALS" \
        --url "$RPC_URL" --fee-payer "$PAYER_KEYPAIR" >/dev/null
fi
echo "     mint $MINT"

echo "2/3  creating the authority's associated token account"
spl-token create-account "$MINT" --url "$RPC_URL" \
    --fee-payer "$PAYER_KEYPAIR" --owner "$AUTHORITY" >/dev/null 2>&1 ||
    echo "     it already exists"
ATA="$(spl-token address --verbose --token "$MINT" --owner "$AUTHORITY" --url "$RPC_URL" 2>/dev/null | awk -F': *' '/Associated token address/{print $2}')"
[ -n "$ATA" ] && echo "     ata  $ATA"

echo "3/3  minting $MINT_WHOLE_TOKENS whole tokens to it"
spl-token mint "$MINT" "$MINT_WHOLE_TOKENS" --url "$RPC_URL" \
    --fee-payer "$PAYER_KEYPAIR" --mint-authority "$PAYER_KEYPAIR" >/dev/null
echo "     done"

# The transfer amount: one whole token, in base units. Kept small so the mint lasts many runs.
AMOUNT_BASE_UNITS="$((10 ** DECIMALS))"

# The recipient only needs to be an address; the example creates its token account itself with
# CreateIdempotent, which is part of what the example is demonstrating.
RECIPIENT="${RECIPIENT:-$(solana-keygen new --no-bip39-passphrase --silent --force \
    --outfile "$HOME/.cache/commitonce/spl-example-recipient.json" >/dev/null && \
    solana-keygen pubkey "$HOME/.cache/commitonce/spl-example-recipient.json")}"

echo
echo "Setup complete. Export these, then run the example:"
echo
echo "  export RPC_URL=$RPC_URL"
echo "  export KEYPAIR=$PAYER_KEYPAIR"
echo "  export MINT=$MINT"
echo "  export RECIPIENT=$RECIPIENT"
echo "  export AMOUNT_BASE_UNITS=$AMOUNT_BASE_UNITS"
echo "  export ORDER_ID=order_$(date +%s)"
echo
echo "  node examples/spl-transfer/index.ts"
echo
echo "ORDER_ID must be new each run: it is the idempotency key, so reusing one that already has"
echo "a live receipt makes phase 1 fail with AlreadyCommitted instead of transferring."
