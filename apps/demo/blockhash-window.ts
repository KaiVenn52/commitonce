/**
 * How long is a blockhash actually valid?
 *
 * `MIN_RETENTION_SECONDS` is one hour, and the entire retention design rests on that being far
 * longer than the window in which a signed transaction stays executable. The docs put that
 * window at "roughly `MAX_PROCESSING_AGE` slots — about 40 seconds at mainnet's measured 265 ms",
 * which is `150 × 265 ms` — a figure derived from two constants rather than measured.
 *
 * This measures it directly: take a blockhash, then poll `isBlockhashValid` until the cluster
 * says no, and report the elapsed time and the slot span. That is the quantity the safety margin
 * is actually a margin against.
 *
 * Run:
 *   RPC_URL=https://api.mainnet-beta.solana.com node apps/demo/blockhash-window.ts
 */

import { createSolanaRpc } from '@solana/kit';

const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com';

async function main(): Promise<void> {
    const rpc = createSolanaRpc(RPC_URL);
    const version = await rpc.getVersion().send();
    console.log('CommitOnce — how long is a blockhash actually valid?');
    console.log(`  rpc      ${RPC_URL}`);
    console.log(`  version  ${version['solana-core']}`);
    console.log();

    const { value: latest } = await rpc.getLatestBlockhash().send();
    const startSlot = await rpc.getSlot().send();
    const start = Date.now();

    console.log(`  blockhash        ${latest.blockhash}`);
    console.log(`  start slot       ${startSlot}`);
    console.log(`  lastValidHeight  ${latest.lastValidBlockHeight}`);
    console.log();
    console.log('  polling isBlockhashValid every second...');

    let valid = true;
    let lastValidSlot = startSlot;
    let lastValidAt = start;
    let polls = 0;

    while (valid) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        polls += 1;
        const result = await rpc.isBlockhashValid(latest.blockhash, { commitment: 'confirmed' }).send();
        valid = result.value;
        if (valid) {
            lastValidSlot = await rpc.getSlot().send();
            lastValidAt = Date.now();
        }
        if (polls > 180) {
            console.log('  still valid after 180s; giving up');
            return;
        }
    }

    const seconds = (lastValidAt - start) / 1000;
    const slots = Number(lastValidSlot - startSlot);
    const rate = slots / seconds;

    console.log();
    console.log(`  valid for        ${seconds.toFixed(1)}s  (${slots} slots, ${rate.toFixed(2)} slots/s)`);
    console.log(`  invalid after    ${polls}s of polling`);
    console.log();
    console.log('  the program requires MIN_RETENTION_SECONDS = 3600 (one hour).');
    console.log(`  measured margin  ${(3600 / seconds).toFixed(0)}x the observed window`);
    console.log();
    console.log('  The docs state "roughly MAX_PROCESSING_AGE slots ~= 40s" and a "95x" margin,');
    console.log('  both derived from constants rather than measured. Compare them with the above.');
}

main().catch((error: unknown) => {
    console.error(`\nBlockhash-window measurement failed: ${String(error)}`);
    process.exit(1);
});
