/**
 * Does a **real Agave validator** refuse a transaction whose writable account is not
 * rent-exempt?
 *
 * `docs/SECURITY_MODEL.md` §T2b records this as open. LiteSVM 0.16 refuses such a transaction
 * with `InsufficientFundsForRent` *before executing anything*, which means the one-lamport
 * version of the pre-funded-PDA griefing attack cannot even be set up. That is a strong claim
 * about the runtime and it was measured in a harness, so it needed checking against the thing
 * itself.
 *
 * The test is deliberately narrow. It does not run the demo:
 *
 *   1. an attacker sends the victim's receipt PDA **one lamport**;
 *   2. the victim submits a transaction containing `claim` for that key;
 *   3. the question is whether the *runtime* rejects it before `claim` runs.
 *
 * Run against a local validator:
 *   RPC_URL=http://127.0.0.1:8899 PAYER_KEYPAIR=~/.config/solana/id.json \
 *   node apps/demo/rent-exemption-check.ts
 */

import { readFile } from 'node:fs/promises';

import {
    address,
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
import { getTransferSolInstruction } from '@solana-program/system';
import { createCommitOnceClient } from '@commitonce/solana';

function requireEnv(name: string): string {
    const value = process.env[name];
    if (value === undefined || value.trim() === '') {
        throw new Error(`CommitOnce rent-exemption check: ${name} is required.`);
    }
    return value.trim();
}

const RPC_URL = requireEnv('RPC_URL');
const PAYER_PATH = requireEnv('PAYER_KEYPAIR');

async function loadSigner(path: string): Promise<KeyPairSigner> {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 64) {
        throw new Error(`${path} is not a Solana CLI keypair.`);
    }
    return await createKeyPairSignerFromBytes(Uint8Array.from(parsed as number[]));
}

/**
 * Render a runtime error without tripping over BigInt.
 *
 * `JSON.stringify` throws on BigInt, and a runtime error can carry lamport amounts — so the
 * naive form fails at exactly the moment it is needed, which is what happened here.
 */
function formatError(error: unknown): string {
    return JSON.stringify(error, (_key, value) => (typeof value === 'bigint' ? `${value}n` : value));
}

async function main(): Promise<void> {
    const rpc = createSolanaRpc(RPC_URL);
    const payer = await loadSigner(PAYER_PATH);
    const commitOnce = createCommitOnceClient({ rpc });

    console.log('CommitOnce — is rent-exemption enforced by the runtime, or only by the harness?');
    console.log(`  rpc      ${RPC_URL}`);
    console.log(`  payer    ${payer.address}`);
    const version = await rpc.getVersion().send();
    console.log(`  version  ${version['solana-core']}`);
    console.log();

    const balance = await rpc.getBalance(payer.address).send();
    if (balance.value < 100_000_000n) {
        throw new Error(`payer holds ${balance.value} lamports; needs more`);
    }

    const namespace = `rent-check:${Date.now()}`;

    // The victim is an ordinary funded account. It is the *authority*, so only it can claim.
    const victim = payer;

    const guard = await commitOnce.prepare({
        authority: victim.address,
        namespace,
        idempotencyKey: 'order_928',
        intent: { action: 'rent-exemption-check' },
        retention: '24h',
    });
    const receipt = guard.receipt;

    console.log(`  receipt PDA  ${receipt}`);
    console.log();

    // ---------------------------------------------------------------------------------
    // 1. The attacker sends one lamport.
    // ---------------------------------------------------------------------------------
    console.log('1. an attacker sends the receipt PDA one lamport');

    const attacker = await generateKeyPairSigner();
    {
        const { value: blockhash } = await rpc.getLatestBlockhash().send();
        const tx = await signTransactionMessageWithSigners(
            pipe(
                createTransactionMessage({ version: 0 }),
                (m) => setTransactionMessageFeePayerSigner(victim, m),
                (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
                (m) =>
                    appendTransactionMessageInstructions(
                        [
                            // Fund the attacker so the transfer is affordable.
                            getTransferSolInstruction({
                                source: victim,
                                destination: attacker.address,
                                amount: 10_000_000n,
                            }),
                        ],
                        m,
                    ),
            ),
        );
        const funding = await rpc
            .sendTransaction(getBase64EncodedWireTransaction(tx), {
                encoding: 'base64',
                preflightCommitment: 'confirmed',
            })
            .send();

        // `sendTransaction` returns a signature, not a confirmation, so reading the balance
        // immediately races the cluster. Poll instead of sleeping a guessed amount.
        let attackerBalance = 0n;
        for (let attempt = 0; attempt < 30 && attackerBalance === 0n; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            attackerBalance = (await rpc.getBalance(attacker.address).send()).value;
        }
        console.log(`   attacker funded: ${funding.slice(0, 16)}… balance ${attackerBalance}`);
        if (attackerBalance === 0n) {
            throw new Error(
                'the attacker was not funded, so the rest of this check would measure nothing',
            );
        }
    }

    {
        const { value: blockhash } = await rpc.getLatestBlockhash().send();
        const tx = await signTransactionMessageWithSigners(
            pipe(
                createTransactionMessage({ version: 0 }),
                (m) => setTransactionMessageFeePayerSigner(attacker, m),
                (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
                (m) =>
                    appendTransactionMessageInstructions(
                        [
                            getTransferSolInstruction({
                                source: attacker,
                                destination: receipt,
                                amount: 1n,
                            }),
                        ],
                        m,
                    ),
            ),
        );
        // Simulated rather than sent, so the runtime's own error is available in structured
        // form. `sendTransaction` preflight reports `Transaction simulation failed` and puts
        // nothing usable in `context.logs` here, which is exactly the wrong amount of detail
        // for the question being asked.
        const simulation = await rpc
            .simulateTransaction(getBase64EncodedWireTransaction(tx), {
                encoding: 'base64',
                commitment: 'confirmed',
                sigVerify: false,
            })
            .send();

        const value = simulation.value;
        if (value.err === null) {
            console.log('   ACCEPTED by the runtime');
        } else {
            // `err` can carry BigInt (lamport amounts), which JSON.stringify refuses.
            console.log(`   REJECTED  ${formatError(value.err)}`);
        }
        for (const line of value.logs ?? []) console.log(`     ${line}`);
    }

    const account = await rpc.getAccountInfo(receipt, { encoding: 'base64' }).send();
    console.log(
        `   account   ${account.value === null ? 'does not exist' : `${account.value.lamports} lamports, owner ${account.value.owner}`}`,
    );
    console.log();

    // ---------------------------------------------------------------------------------
    // 2. The victim claims.
    // ---------------------------------------------------------------------------------
    console.log('2. the victim submits `claim` for that key');

    const victimGuard = await commitOnce.prepare({
        authority: victim.address,
        namespace,
        idempotencyKey: 'order_928',
        intent: { action: 'rent-exemption-check' },
        retention: '24h',
    });

    {
        const { value: blockhash } = await rpc.getLatestBlockhash().send();
        const tx = await signTransactionMessageWithSigners(
            pipe(
                createTransactionMessage({ version: 0 }),
                (m) => setTransactionMessageFeePayerSigner(victim, m),
                (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
                (m) => appendTransactionMessageInstructions([victimGuard.instruction], m),
            ),
        );
        try {
            const signature = await rpc
                .sendTransaction(getBase64EncodedWireTransaction(tx), {
                    encoding: 'base64',
                    preflightCommitment: 'confirmed',
                })
                .send();
            console.log(`   ACCEPTED  ${signature}`);
            console.log(`   explorer  https://explorer.solana.com/tx/${signature}?cluster=custom`);
        } catch (error: unknown) {
            const logs = (error as { context?: { logs?: readonly string[] } })?.context?.logs ?? [];
            console.log(`   REJECTED  ${error instanceof Error ? error.message : String(error)}`);
            for (const line of logs) console.log(`     ${line}`);
        }
    }

    console.log();
    console.log('Interpretation:');
    console.log('  If step 2 was ACCEPTED, the runtime does NOT refuse a non-rent-exempt writable');
    console.log('  account, the one-lamport griefing attack is constructible, and the top-up path');
    console.log('  in `claim` is the thing that defeats it.');
    console.log('  If step 2 was REJECTED with InsufficientFundsForRent, the runtime refuses the');
    console.log('  transaction before `claim` runs and the attack cannot be set up at all.');
}

main().catch((error: unknown) => {
    console.error(`\nRent-exemption check failed: ${String(error)}`);
    process.exit(1);
});
