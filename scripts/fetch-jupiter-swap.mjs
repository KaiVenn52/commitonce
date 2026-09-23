/**
 * Fetch a real swap transaction from Jupiter's live API and print it as base64.
 *
 * This is the other half of the jupiter-swap example. The example deliberately does **not**
 * encode Jupiter's request or response format — that is Jupiter's to define, and guessing at it
 * would produce code that looks authoritative and is wrong. This script uses the real API
 * instead, so the example can be exercised against a genuinely real third-party transaction
 * rather than a hand-written stand-in.
 *
 * It also writes the fixture committed at `examples/jupiter-swap/fixtures/`, so the dry run is
 * reproducible without calling Jupiter at all. See `fixtures/README.md`.
 *
 * **No funds and no keypair are needed.** A quote is public, and the swap endpoint only needs a
 * `user` public key to build the transaction. Nothing is signed and nothing is submitted — the
 * returned transaction is unsigned, which is why committing it is safe.
 *
 * Usage:
 *   node scripts/fetch-jupiter-swap.mjs                     # print base64
 *   node scripts/fetch-jupiter-swap.mjs --out path.base64   # write it to a file
 *   node scripts/fetch-jupiter-swap.mjs --user <address>    # build for a different fee payer
 */

import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
function flag(name, fallback) {
    const index = args.indexOf(name);
    return index === -1 ? fallback : args[index + 1];
}

// A public RPC endpoint would do, but the quote API needs no RPC at all.
const API = 'https://lite-api.jup.ag/swap/v1';

// Defaults: 0.001 SOL -> USDC, which is small enough to be a rounding error on mainnet and is
// the pair the committed fixture uses.
const INPUT_MINT = flag('--input-mint', 'So11111111111111111111111111111111111111112'); // wSOL
const OUTPUT_MINT = flag('--output-mint', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
const AMOUNT = flag('--amount', '1000000');
const SLIPPAGE_BPS = flag('--slippage-bps', '50');
const USER = flag('--user', '25TUohqYd5b6f97wc5CjMwj89ZVL8oX81nhkWVHimYpY');
const OUT = flag('--out', null);

const quoteUrl =
    `${API}/quote?inputMint=${INPUT_MINT}&outputMint=${OUTPUT_MINT}` +
    `&amount=${AMOUNT}&slippageBps=${SLIPPAGE_BPS}&restrictIntermediateTokens=true`;

const quoteResponse = await fetch(quoteUrl);
if (!quoteResponse.ok) {
    console.error(`quote failed: HTTP ${quoteResponse.status} ${await quoteResponse.text()}`);
    process.exit(1);
}
const quote = await quoteResponse.json();

console.error(`inAmount        ${quote.inAmount}`);
console.error(`outAmount       ${quote.outAmount}`);
console.error(`route           ${(quote.routePlan ?? []).map((r) => r.swapInfo?.label).join(' -> ')}`);
console.error(`priceImpactPct  ${quote.priceImpactPct}`);

const swapResponse = await fetch(`${API}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: USER,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: { maxLamports: 100000, priorityLevel: 'medium' },
        },
    }),
});
if (!swapResponse.ok) {
    console.error(`swap build failed: HTTP ${swapResponse.status} ${await swapResponse.text()}`);
    process.exit(1);
}
const swap = await swapResponse.json();

if (typeof swap.swapTransaction !== 'string' || swap.swapTransaction.length === 0) {
    console.error(`no swapTransaction in the response; keys: ${Object.keys(swap).join(', ')}`);
    process.exit(1);
}

const bytes = Buffer.from(swap.swapTransaction, 'base64');
const signatureCount = bytes[0];
const signed = !bytes.subarray(1, 65).every((b) => b === 0);

console.error(`\nserialized      ${bytes.length} bytes`);
console.error(`version         0x${bytes[1 + signatureCount * 64].toString(16)}`);
console.error(`signed          ${signed ? 'YES — do not commit this' : 'no (unsigned, safe to commit)'}`);
console.error(`sha256          ${createHash('sha256').update(swap.swapTransaction).digest('hex')}`);

if (OUT !== null) {
    writeFileSync(OUT, swap.swapTransaction, 'utf8');
    console.error(`\nwritten to ${OUT}`);
} else {
    process.stdout.write(swap.swapTransaction);
}
