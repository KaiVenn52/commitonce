/**
 * What is the real slot rate?
 *
 * `docs/ARCHITECTURE.md` states `SLOTS_PER_SECOND = 4`, justified as "mainnet's 250 ms slots
 * since epoch 1036". The receipt's `expires_at_slot` is derived from that constant, and the retention
 * window is a security-relevant parameter, so the constant is worth measuring rather than
 * repeating.
 *
 * Slots are sampled by reading the current slot and the cluster's own clock over a window, which
 * is the rate that matters: `expires_at_slot` counts slots, and the wall-clock gate counts
 * seconds, so what decides which gate binds is slots-per-second.
 *
 * Run:
 *   RPC_URL=https://api.mainnet-beta.solana.com node apps/demo/slot-rate.ts
 *   RPC_URL=https://api.devnet.solana.com node apps/demo/slot-rate.ts
 */

import { createSolanaRpc } from '@solana/kit';

const RPC_URL = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
const SECONDS = Number(process.env.SECONDS ?? '30');

async function main(): Promise<void> {
    const rpc = createSolanaRpc(RPC_URL);
    const version = await rpc.getVersion().send();
    console.log(`CommitOnce — what is the real slot rate?`);
    console.log(`  rpc      ${RPC_URL}`);
    console.log(`  version  ${version['solana-core']}`);
    console.log(`  window   ${SECONDS}s`);
    console.log();

    // Warm up so the first sample is not the connection latency.
    await rpc.getSlot().send();

    const start = Date.now();
    const startSlot = await rpc.getSlot().send();
    let samples = 0;
    let lastSlot = startSlot;

    const deadline = start + SECONDS * 1000;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const slot = await rpc.getSlot().send();
        if (slot > lastSlot) samples += 1;
        lastSlot = slot;
    }

    const elapsedMs = Date.now() - start;
    const elapsedS = elapsedMs / 1000;
    const slots = Number(lastSlot - startSlot);
    const rate = slots / elapsedS;

    console.log(`  slots    ${startSlot} -> ${lastSlot}  (${slots} slots)`);
    console.log(`  elapsed  ${elapsedS.toFixed(2)}s  (${samples} advancing samples)`);
    console.log(`  rate     ${rate.toFixed(3)} slots/second  (${(1000 / rate).toFixed(1)} ms/slot)`);
    console.log();
    console.log(`  the constant in the program is 4 slots/second.`);
    console.log(
        `  measured is ${rate > 4 ? 'FASTER' : rate < 4 ? 'SLOWER' : 'the same'} by ` +
            `${Math.abs(((rate - 4) / 4) * 100).toFixed(1)}%.`,
    );
    console.log();
    console.log('  Consequence, given that `close_receipt` requires BOTH deadlines:');
    console.log('    faster than 4  -> the slot gate passes early, the wall-clock gate binds,');
    console.log('                      so the window is exactly as advertised.');
    console.log('    slower than 4  -> the slot gate passes late, so cleanup is delayed.');
    console.log('    Either way cleanup can only be delayed, never accelerated.');
}

main().catch((error: unknown) => {
    console.error(`\nSlot-rate measurement failed: ${String(error)}`);
    process.exit(1);
});
