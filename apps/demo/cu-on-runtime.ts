/**
 * What does `claim` actually cost on a **real Agave runtime**?
 *
 * `EVIDENCE.md` records: *"CU figures on mainnet: not measured. And the harness does not match the
 * runtime: devnet reported `claim` at 14,669 CU against the harness's 9,283 median, so the
 * in-process numbers are a lower bound."*
 *
 * A 58% gap is large enough that it is worth knowing which side is wrong, and a real validator
 * settles it. LiteSVM implements its own compute accounting; Agave's is the one that bills.
 *
 * This measures three transactions against a running cluster and prints the runtime's own
 * per-program figures, so the harness can be characterised rather than just distrusted.
 *
 * Run against a local validator or devnet:
 *   RPC_URL=http://127.0.0.1:8899 PAYER_KEYPAIR=~/.config/solana/id.json \
 *   node apps/demo/cu-on-runtime.ts
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
        throw new Error(`CommitOnce CU measurement: ${name} is required.`);
    }
    return value.trim();
}

const RPC_URL = requireEnv('RPC_URL');
const PAYER_PATH = requireEnv('PAYER_KEYPAIR');

const COMMIT_ONCE = 'CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB';

async function loadSigner(path: string): Promise<KeyPairSigner> {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 64) {
        throw new Error(`${path} is not a Solana CLI keypair.`);
    }
    return await createKeyPairSignerFromBytes(Uint8Array.from(parsed as number[]));
}

/** Pull the runtime's own per-program consumption out of the transaction meta. */
function commitOnceCu(meta: {
    logMessages?: readonly string[] | null;
    computeUnitsConsumed?: bigint | number | null;
}): { program: number | null; total: number | null } {
    let program: number | null = null;
    for (const line of meta.logMessages ?? []) {
        const match = new RegExp(`Program ${COMMIT_ONCE} consumed (\\d+) of`).exec(line);
        if (match) program = Number(match[1]);
    }
    const total = meta.computeUnitsConsumed === null || meta.computeUnitsConsumed === undefined
        ? null
        : Number(meta.computeUnitsConsumed);
    return { program, total };
}

async function main(): Promise<void> {
    const rpc = createSolanaRpc(RPC_URL);
    const payer = await loadSigner(PAYER_PATH);
    const commitOnce = createCommitOnceClient({ rpc });

    const version = await rpc.getVersion().send();
    console.log('CommitOnce — what does `claim` cost on a real Agave runtime?');
    console.log(`  rpc      ${RPC_URL}`);
    console.log(`  version  ${version['solana-core']}`);
    console.log();

    const balance = await rpc.getBalance(payer.address).send();
    if (balance.value < 200_000_000n) {
        throw new Error(`payer holds ${balance.value} lamports; needs more`);
    }

    /** Send one guarded transaction and report the runtime's figures. */
    async function measure(label: string, key: string, intent: string): Promise<void> {
        const guard = await commitOnce.prepare({
            authority: payer.address,
            namespace: `cu:${version['solana-core']}`,
            idempotencyKey: key,
            intent: { action: 'cu-measurement', label: intent },
            retention: '24h',
        });

        const { value: blockhash } = await rpc.getLatestBlockhash().send();
        const tx = await signTransactionMessageWithSigners(
            pipe(
                createTransactionMessage({ version: 0 }),
                (m) => setTransactionMessageFeePayerSigner(payer, m),
                (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
                (m) => appendTransactionMessageInstructions([guard.instruction], m),
            ),
        );
        const signature = getSignatureFromTransaction(tx);

        // `skipPreflight` because the second measurement is a *duplicate*, which is meant to
        // fail. Preflight would reject it before it ever landed and there would be no meta to
        // read — and the compute a rejected duplicate consumes is exactly what is being
        // measured here.
        await rpc
            .sendTransaction(getBase64EncodedWireTransaction(tx), {
                encoding: 'base64',
                skipPreflight: true,
                maxRetries: 0n,
            })
            .send();

        // Wait for the meta, which is where the runtime's figures live.
        let meta: Awaited<ReturnType<typeof fetchMeta>> = null;
        for (let attempt = 0; attempt < 40 && meta === null; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            meta = await fetchMeta(signature);
        }
        if (meta === null || meta.meta === null) {
            console.log(`  ${label.padEnd(26)} (no meta after 20s)`);
            return;
        }
        // `getTransaction` returns `{ meta, transaction }`; the runtime's figures are on `meta`.
        const cu = commitOnceCu(meta.meta);
        const outcome = meta.meta.err === null ? 'ok' : 'rejected';
        console.log(
            `  ${label.padEnd(26)} ${outcome.padEnd(9)} commit_once ${String(cu.program).padStart(7)} CU   ` +
                `transaction total ${String(cu.total).padStart(7)} CU`,
        );
        if (meta.meta.err !== null) {
            // A rejected transaction consumes less compute, so its figure measures the failure
            // rather than the instruction. Say so rather than letting the number stand.
            console.log(`      err  ${JSON.stringify(meta.meta.err, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v))}`);
            for (const line of (meta.meta.logMessages ?? []).slice(-6)) console.log(`      ${line}`);
        }
    }

    async function fetchMeta(signature: string) {
        const response = await rpc
            .getTransaction(signature as never, {
                encoding: 'json',
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
            })
            .send();
        return response;
    }

    console.log("the runtime's own figures:");

    // Keys must be unique per run. A fixed key means the second invocation of this script finds
    // a receipt that already exists, and both measurements report a *rejected* transaction —
    // whose compute figure measures the failure rather than `claim`. That is exactly what the
    // first version of this script did.
    const run = Date.now().toString();
    await measure('claim (creates receipt)', `cu_create_${run}`, 'create');
    await measure('claim (blocked duplicate)', `cu_create_${run}`, 'create');
    console.log();
    console.log('Compare against the harness in EVIDENCE.md: claim alone reports a 9,283 median');
    console.log('over nine environments, with a 12,283 maximum.');
    void generateKeyPairSigner;
}

main().catch((error: unknown) => {
    console.error(`\nCU measurement failed: ${String(error)}`);
    process.exit(1);
});
