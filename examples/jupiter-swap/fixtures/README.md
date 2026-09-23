# Jupiter swap fixtures

## `jupiter-swap-mainnet.base64`

A **real** swap transaction built by Jupiter's live aggregator API, committed so that
`--dry-run` is reproducible without calling Jupiter.

| | |
| --- | --- |
| Source | `POST https://lite-api.jup.ag/swap/v1/swap` (Jupiter's public API) |
| Route | Meteora DLMM → AlphaQ |
| Pair | 1,000,000 lamports (0.001 SOL) → USDC |
| Slippage | 50 bps |
| Serialized size | 922 bytes (1,232 base64 characters) |
| Version | v0 (`0x80` prefix) |
| Instructions | 8 — `SetComputeUnitLimit`, `SetComputeUnitPrice`, two `CreateIdempotent`, a System transfer, a Token instruction, the Jupiter v6 swap (`JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`, 47 accounts), and a Token close |
| Signed? | **No.** Signature count is 1 and the signature block is all zeroes. Jupiter returns an unsigned transaction for the caller to sign, which is why this is safe to commit. |

**No secret is in this file.** It is an unsigned transaction whose only key material is public
addresses. The fee payer is `25TUohqYd5b6f97wc5CjMwj89ZVL8oX81nhkWVHimYpY`.

### Why it is committed

So that the example's composition path can be exercised by anyone, offline from Jupiter:

```bash
RPC_URL=https://api.mainnet-beta.solana.com \
KEYPAIR=~/.config/solana/id.json \
JUPITER_SWAP_TX_FILE=examples/jupiter-swap/fixtures/jupiter-swap-mainnet.base64 \
INPUT_MINT=So11111111111111111111111111111111111111112 \
OUTPUT_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
AMOUNT_BASE_UNITS=1000000 \
DRY_RUN=1 \
node examples/jupiter-swap/index.ts
```

A mainnet RPC endpoint is still needed, because the transaction's address lookup tables have to
be resolved on the cluster they live on. **Jupiter's API is not needed**, and neither is a
funded keypair: the dry run signs but never submits.

The keypair must match the transaction's fee payer, because the guard's authority has to sign.
Regenerate the fixture for your own key with `scripts/fetch-jupiter-swap.mjs`.

### This file will age

A swap transaction is a point-in-time artifact: the blockhash expires, and Jupiter would return
a different transaction — different route, different intermediate accounts, different compute
budget — for the same request on the next call. That is not a defect in the fixture, it is the
exact property the example exists to make visible: **the transaction changes on every quote
while the user's intent does not.**

The dry run is unaffected by the stale blockhash, because it rebuilds the lifetime from a fresh
one before composing. It is affected by the lookup tables being deactivated eventually, so if
this fixture stops resolving, regenerate it.
