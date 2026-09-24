/**
 * The full receipt lifecycle on a live cluster: claim, wait out the retention, close, get the
 * rent back.
 *
 * Every other on-chain path in this repository has been executed against devnet. This one has
 * not, and the reason is boring: `MIN_RETENTION_SECONDS` is one hour, so demonstrating the
 * refund means waiting an hour. The Rust suite covers it in LiteSVM by warping the clock, which
 * is a real test of the program and not a real demonstration of the refund.
 *
 * That matters because "an explicit retention window with a full rent refund" is a claim this
 * project makes, and the refund is the half that returns the user's money.
 *
 * The script claims with the minimum finite retention, then polls until both deadlines have
 * passed, then closes. It prints a timestamped line at each step so it can be watched while it
 * runs.
 *
 * Run:
 *   RPC_URL=https://api.devnet.solana.com \
 *   PAYER_KEYPAIR=~/.config/solana/id.json \
 *   node apps/demo/receipt-lifecycle.ts
 */

import { readFile } from 'node:fs/promises';

import {
    appendTransactionMessageInstructions,
    createKeyPairSignerFromBytes,
    createSolanaRpc,
    createTransactionMessage,
    generateKeyPairSigner,
    getBase64EncodedWireTransaction,
    getSignatureFromTransaction,
    pipe,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    type KeyPairSigner,
} from '@solana/kit';
import { createCommitOnceClient } from '@commitonce/solana';

function requireEnv(name: string): string {
    const value = process.env[name];
    if (value === undefined || value.trim() === '') {
        throw new Error(`CommitOnce receipt lifecycle: ${name} is required.`);
    }
    return value.trim();
}

const RPC_URL = requireEnv('RPC_URL');
const PAYER_PATH = requireEnv('PAYER_KEYPAIR');

/** One hour: the shortest finite retention the program accepts. */
const RETENTION_SECONDS = 3600n;
/** Stop waiting after this, so the job cannot hang forever. */
const MAX_WAIT_SECONDS = 4500;

async function loadSigner(path: string): Promise<KeyPairSigner> {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 64) {
        throw new Error(`${path} is not a Solana CLI keypair.`);
    }
    return await createKeyPairSignerFromBytes(Uint8Array.from(parsed as number[]));
}

function stamp(): string {
    return new Date().toISOString().slice(11, 19);
}

function log(message: string): void {
    console.log(`[${stamp()}] ${message}`);
}

async function main(): Promise<void> {
    const rpc = createSolanaRpc(RPC_URL);
    const payer = await loadSigner(PAYER_PATH);
    const commitOnce = createCommitOnceClient({ rpc });

    const version = await rpc.getVersion().send();
    log(`CommitOnce — full receipt lifecycle on ${RPC_URL} (${version['solana-core']})`);
    log(`authority ${payer.address}`);
    console.log();

    const balance = await rpc.getBalance(payer.address).send();
    if (balance.value < 100_000_000n) {
        throw new Error(`payer holds ${balance.value} lamports; needs more`);
    }

    // A dedicated refund destination, so the refund is visibly a separate account rather than
    // the payer's own balance moving around.
    const refund = await generateKeyPairSigner();

    // ---------------------------------------------------------------------------------
    // 1. Claim with the minimum finite retention.
    // ---------------------------------------------------------------------------------
    const namespace = `lifecycle:${Date.now()}`;
    const guard = await commitOnce.prepare({
        authority: payer.address,
        namespace,
        idempotencyKey: 'order_lifecycle',
        intent: { action: 'receipt-lifecycle' },
        retention: '1h',
        refundDestination: refund.address,
    });

    log(`1. claim  receipt=${guard.receipt}  retention=${RETENTION_SECONDS}s`);
    log(`          refund destination ${refund.address}`);

    {
        const { value: blockhash } = await rpc.getLatestBlockhash().send();
        const tx = await signTransactionMessageWithSigners(
            pipe(
                createTransactionMessage({ version: 0 }),
                (m) => setTransactionMessageFeePayerSigner(payer, m),
                (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
                (m) => appendTransactionMessageInstructions([guard.instruction], m),
            ),
        );
        const signature = await rpc
            .sendTransaction(getBase64EncodedWireTransaction(tx), {
                encoding: 'base64',
                preflightCommitment: 'confirmed',
            })
            .send();
        log(`   committed ${signature}`);
    }

    // Wait for the receipt to be readable, then record what it holds.
    let receiptLamports = 0n;
    for (let attempt = 0; attempt < 40 && receiptLamports === 0n; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const info = await rpc.getAccountInfo(guard.receipt, { encoding: 'base64' }).send();
        receiptLamports = info.value?.lamports ?? 0n;
    }
    const refundBefore = (await rpc.getBalance(refund.address).send()).value;
    log(`   receipt holds ${receiptLamports} lamports; refund destination has ${refundBefore}`);
    console.log();

    // ---------------------------------------------------------------------------------
    // 2. Wait for BOTH deadlines.
    //
    // The receipt stores `expires_at_unix_ts`, so the wait can end when the deadline actually
    // passes rather than after a fixed guess. The first version of this script polled for
    // `MAX_WAIT_SECONDS` and then closed, which meant it always took 75 minutes to demonstrate a
    // 60-minute window — correct, and 15 minutes of nothing.
    //
    // The wall-clock deadline is only one of the two gates. The slot deadline is derived from
    // `SLOTS_PER_SECOND`, which is at or above mainnet's real rate, so on a faster cluster the
    // slot gate can fall *after* the wall-clock gate. The close is therefore attempted, and a
    // `ReceiptNotExpired` response is treated as "not yet" rather than as a failure.
    // ---------------------------------------------------------------------------------
    const startedAt = Date.now();
    log(`2. waiting for the retention window to pass (${RETENTION_SECONDS}s)`);

    let deadlineMs = startedAt + Number(RETENTION_SECONDS) * 1000;
    const info = await rpc.getAccountInfo(guard.receipt, { encoding: 'base64' }).send();
    if (info.value !== null) {
        const decoded = commitOnce.decodeReceipt(info.value.data);
        if (decoded !== null) {
            deadlineMs = Number(decoded.expiresAtUnixTs) * 1000;
            log(
                `   expires_at_unix_ts ${decoded.expiresAtUnixTs} ` +
                    `(${Math.round((deadlineMs - startedAt) / 1000)}s from now)`,
            );
        }
    }

    while (Date.now() < deadlineMs) {
        const remaining = Math.round((deadlineMs - Date.now()) / 1000);
        if (remaining > 0) {
            log(`   ${remaining}s remaining; receipt still present (as it must be)`);
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, Math.max(1_000, remaining * 1000))));
    }

    const exists = (await rpc.getAccountInfo(guard.receipt, { encoding: 'base64' }).send()).value !== null;
    if (!exists) {
        throw new Error('the receipt disappeared before this script closed it');
    }
    log(`   deadline passed after ${Math.round((Date.now() - startedAt) / 1000)}s`);

    // ---------------------------------------------------------------------------------
    // 3. Close, and verify the rent came back.
    // ---------------------------------------------------------------------------------
    log('3. close_receipt');

    {
        const closeIx = commitOnce.closeReceiptInstruction({
            receipt: guard.receipt,
            refundDestination: refund.address,
        });
        const { value: blockhash } = await rpc.getLatestBlockhash().send();
        const tx = await signTransactionMessageWithSigners(
            pipe(
                createTransactionMessage({ version: 0 }),
                (m) => setTransactionMessageFeePayerSigner(payer, m),
                (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
                (m) => appendTransactionMessageInstructions([closeIx], m),
            ),
        );
        const signature = getSignatureFromTransaction(tx);

        // The slot gate may not have passed yet even though the wall-clock gate has, so retry
        // rather than treating a rejection as fatal.
        let sent = false;
        for (let attempt = 0; attempt < 20 && !sent; attempt += 1) {
            try {
                await rpc
                    .sendTransaction(getBase64EncodedWireTransaction(tx), {
                        encoding: 'base64',
                        preflightCommitment: 'confirmed',
                    })
                    .send();
                sent = true;
                log(`   closed ${signature}`);
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                const logs = (error as { context?: { logs?: readonly string[] } })?.context?.logs ?? [];
                const notExpired = logs.some((l) => /ReceiptNotExpired|0x1779|6009/.test(l));
                if (!notExpired) throw error;
                log(`   slot gate has not passed yet; retrying in 30s (${message.slice(0, 40)})`);
                await new Promise((resolve) => setTimeout(resolve, 30_000));
            }
        }
        if (!sent) throw new Error('close_receipt was still refused after 20 attempts');
    }

    // Poll rather than sleep a guessed amount: `sendTransaction` returns a signature, not a
    // confirmation, so reading balances immediately races the cluster.
    let receiptGone = false;
    let refundAfter = refundBefore;
    for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        receiptGone = (await rpc.getAccountInfo(guard.receipt, { encoding: 'base64' }).send()).value === null;
        refundAfter = (await rpc.getBalance(refund.address).send()).value;
        if (receiptGone && refundAfter > refundBefore) break;
    }

    console.log();
    log(`   receipt account gone   ${receiptGone}`);
    log(`   refund destination     ${refundBefore} -> ${refundAfter}`);
    log(`   refunded               ${refundAfter - refundBefore} lamports`);
    log(`   the deposit was        ${receiptLamports} lamports`);
    console.log();
    log(
        receiptGone && refundAfter - refundBefore === receiptLamports
            ? 'VERIFIED: the receipt closed and the full deposit reached the configured destination.'
            : 'NOT VERIFIED: see the figures above.',
    );
    void attempts;
}

main().catch((error: unknown) => {
    console.error(`\nReceipt lifecycle failed: ${String(error)}`);
    process.exit(1);
});
