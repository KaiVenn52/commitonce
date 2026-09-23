/**
 * CommitOnce example: a guarded SOL transfer.
 *
 * One atomic transaction contains:
 *
 *   [ compute budget: SetComputeUnitPrice ]   transport only — changes between attempts
 *   [ commit_once::claim                   ]   the guard
 *   [ System Program: Transfer             ]   the business instruction
 *
 * The claim instruction is prepended to the *same* transaction as the transfer, so the
 * receipt PDA and the transfer commit or roll back together. If the receipt already
 * exists, `claim` errors, the transaction reverts, and the transfer never runs a second
 * time.
 *
 * What this script demonstrates concretely:
 *
 *   1. A guarded transfer is submitted, with retry-on-ambiguous-failure that rebuilds the
 *      transaction with a fresh blockhash and a higher priority fee while reusing the SAME
 *      idempotency key.
 *   2. The same logical intent is then deliberately submitted a second time, as a genuinely
 *      rebuilt transaction (different blockhash, different priority fee, different
 *      signature). The guard blocks it, and the recipient's balance does not move.
 *
 * Run: see README.md in this directory. This example HAS been executed against devnet, against
 * the deployed program; the raw output is in `submission/evidence/devnet-sol-transfer-run.log`.
 */

import { readFile } from 'node:fs/promises';

import { getTransferSolInstruction } from '@solana-program/system';
import {
    address,
    appendTransactionMessageInstructions,
    createKeyPairSignerFromBytes,
    createSolanaRpc,
    createSolanaRpcSubscriptions,
    createTransactionMessage,
    getSignatureFromTransaction,
    isSolanaError,
    pipe,
    sendAndConfirmTransactionFactory,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED,
    SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED,
    type Instruction,
    type KeyPairSigner,
} from '@solana/kit';
import {
    classifyError,
    createCommitOnceClient,
    isAlreadyCommitted,
    isIdempotencyConflict,
    type CanonicalIntent,
    type CommitOnceClient,
} from '@commitonce/solana';

// ---------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------

/**
 * Namespace: application/feature scope. It is part of the receipt PDA derivation, so two
 * applications can use the same textual idempotency key without colliding. Keep it stable —
 * changing it changes the receipt address, and therefore which intent a key protects.
 */
const NAMESPACE = 'examples:sol-transfer';

/**
 * How long the receipt protects this intent. 24 hours by default; the program accepts
 * 'permanent' or 1 hour .. 365 days. A retry that arrives after the receipt has expired
 * (and been cleaned up) is no longer protected — that is the documented window.
 */
const RETENTION = '24h' as const;

const BASE_PRIORITY_FEE_MICRO_LAMPORTS = 1_000n;
const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------------------

function requireEnv(name: string): string {
    const value = process.env[name];
    if (value === undefined || value.trim() === '') {
        throw new Error(
            `CommitOnce example: ${name} is required. See README.md in this directory for the ` +
                'full list of environment variables.',
        );
    }
    return value.trim();
}

const RPC_URL = requireEnv('RPC_URL');

/**
 * The signer is both the fee payer and the intent authority. The authority is part of the
 * receipt PDA seeds, so a third party who learns your namespace and key derives a different
 * receipt and cannot consume or block your intent.
 *
 * Resolved in an immediately-invoked function so the validated value is typed `string`. A
 * plain `const path = process.env.KEYPAIR ?? process.env.WALLET_PATH` followed by a throwing
 * check does narrow at the point of the check, but TypeScript does not carry that narrowing
 * into `main()`, because a function body may run at any time.
 */
const KEYPAIR_PATH: string = (() => {
    const path = process.env.KEYPAIR ?? process.env.WALLET_PATH;
    if (path === undefined || path.trim() === '') {
        throw new Error(
            'CommitOnce example: set KEYPAIR (or WALLET_PATH) to the path of a Solana CLI ' +
                'keypair JSON file — a JSON array of 64 byte values.',
        );
    }
    return path.trim();
})();

/** Subscriptions are only needed by sendAndConfirm. Derive ws:// from http:// unless told otherwise. */
const RPC_WS_URL = process.env.RPC_WS_URL ?? RPC_URL.replace(/^http/, 'ws');

const RECIPIENT = address(requireEnv('RECIPIENT'));
const AMOUNT_LAMPORTS = BigInt(requireEnv('AMOUNT_LAMPORTS'));
const ORDER_ID = process.env.ORDER_ID ?? 'order_928';
const MEMO = process.env.MEMO ?? null;

// ---------------------------------------------------------------------------------------
// Compute budget: the priority fee
// ---------------------------------------------------------------------------------------

const COMPUTE_BUDGET_PROGRAM_ADDRESS = address('ComputeBudget111111111111111111111111111111');

/**
 * Build a ComputeBudget `SetComputeUnitPrice` instruction (tag 3, u64 micro-lamports LE).
 *
 * Hand-encoded deliberately: this repository has no dependency on
 * `@solana-program/compute-budget`, and an example must not import a package that is not
 * installed. If you add that package, replace this function with its
 * `getSetComputeUnitPriceInstruction({ microLamports })` builder — the wire bytes are the
 * same. See README.md, "Placeholders and unverified details".
 *
 * This instruction is a TRANSPORT detail. Its value changes on every retry, which is
 * exactly why it must never be part of the intent fingerprint below.
 */
function setComputeUnitPriceInstruction(microLamports: bigint): Instruction {
    const data = new Uint8Array(9);
    data[0] = 3;
    new DataView(data.buffer).setBigUint64(1, microLamports, true);
    return { programAddress: COMPUTE_BUDGET_PROGRAM_ADDRESS, data };
}

// ---------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------

async function loadKeypairSigner(path: string): Promise<KeyPairSigner> {
    const raw = await readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (
        !Array.isArray(parsed) ||
        parsed.length !== 64 ||
        parsed.some((byte) => typeof byte !== 'number')
    ) {
        throw new Error(
            `CommitOnce example: ${path} is not a Solana CLI keypair. Expected a JSON array ` +
                'of 64 byte values (private key followed by public key).',
        );
    }
    return await createKeyPairSignerFromBytes(Uint8Array.from(parsed as number[]));
}

/** A legible timeline: attempt number, phase, and what is different about this attempt. */
function line(attempt: number | null, phase: string, detail: string): void {
    const stamp = (attempt === null ? '-' : String(attempt)).padEnd(3);
    console.log(`[attempt ${stamp}] ${phase.padEnd(9)} ${detail}`);
}

/** Turn an unrecognised failure into a sentence that says why the outcome is unknown. */
function describeAmbiguous(error: unknown): string {
    if (isSolanaError(error, SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED)) {
        return 'blockhash expired before confirmation';
    }
    if (isSolanaError(error, SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED)) {
        return 'identical signed bytes were already processed';
    }
    // Solana's preflight reports `Transaction simulation failed` and nothing else, which says
    // nothing about *why*. The logs are in `context.logs` and they are the whole point: they
    // name the program that failed and the reason. Without them a reader cannot tell a missing
    // account from a wrong token program from a program that does not exist on this cluster.
    const logs = (error as { context?: { logs?: unknown } })?.context?.logs;
    if (Array.isArray(logs) && logs.length > 0) {
        const interesting = logs
            .map((entry) => String(entry).trim())
            .filter((entry) => entry.length > 0)
            // Drop the per-program "invoke [n]" / "success" bookkeeping and keep what failed.
            .filter((entry) => !/^Program \S+ (invoke \[\d+\]|success)$/.test(entry));
        if (interesting.length > 0) {
            return `simulation failed — ${interesting.slice(-4).join(' | ')}`;
        }
    }

    return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------------------
// The guarded submission
// ---------------------------------------------------------------------------------------

type SubmissionOutcome =
    | { readonly status: 'committed'; readonly signature: string; readonly attempts: number }
    | { readonly status: 'duplicate-blocked'; readonly attempts: number };

type GuardedTransferArgs = {
    readonly rpc: ReturnType<typeof createSolanaRpc>;
    readonly sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>;
    readonly commitOnce: CommitOnceClient;
    readonly authority: KeyPairSigner;
    readonly intent: CanonicalIntent;
    /** Only for the timeline. The key itself never depends on this. */
    readonly label: string;
};

/**
 * Submit the guarded transfer, rebuilding on ambiguous failure.
 *
 * The retry rebuilds everything that is allowed to change — blockhash, priority fee,
 * signature — and rebuilds nothing that defines the intent. That asymmetry is the whole
 * point: a rebuilt transaction has different bytes and a different signature, so Solana's
 * message-hash deduplication cannot stop it, but the receipt PDA can.
 */
async function submitGuardedTransfer(args: GuardedTransferArgs): Promise<SubmissionOutcome> {
    const { rpc, sendAndConfirm, commitOnce, authority, intent, label } = args;
    let priorityFeeMicroLamports = BASE_PRIORITY_FEE_MICRO_LAMPORTS;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        // Rebuilt per attempt: a fresh blockhash and a fresh priority fee.
        const { value: latestBlockhash } = await rpc
            .getLatestBlockhash({ commitment: 'confirmed' })
            .send();

        // Rebuilt per attempt, and byte-identical every time: `prepare` is pure, so the same
        // (authority, namespace, key, intent) always yields the same instruction and receipt.
        const guard = await commitOnce.prepare({
            authority: authority.address,
            namespace: NAMESPACE,
            idempotencyKey: ORDER_ID,
            intent,
            retention: RETENTION,
        });

        const transfer = getTransferSolInstruction({
            source: authority,
            destination: RECIPIENT,
            amount: AMOUNT_LAMPORTS,
        });

        const message = pipe(
            createTransactionMessage({ version: 0 }),
            (m) => setTransactionMessageFeePayerSigner(authority, m),
            (m) =>
                appendTransactionMessageInstructions(
                    [
                        setComputeUnitPriceInstruction(priorityFeeMicroLamports),
                        // The guard is prepended to the SAME transaction as the business
                        // instruction. Never send it as its own transaction: a receipt that
                        // committed separately would block the action it was meant to protect.
                        guard.instruction,
                        transfer,
                    ],
                    m,
                ),
            (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        );

        const transaction = asBlockhashTransaction(await signTransactionMessageWithSigners(message));
        const signature = getSignatureFromTransaction(transaction);

        line(
            attempt,
            'send',
            `${label} blockhash=${latestBlockhash.blockhash.slice(0, 8)}… ` +
                `priorityFee=${priorityFeeMicroLamports}µLamports sig=${signature.slice(0, 8)}…`,
        );

        try {
            await sendAndConfirm(transaction, { commitment: 'confirmed' });
            line(attempt, 'committed', `signature=${signature}`);
            return { status: 'committed', signature, attempts: attempt };
        } catch (error) {
            // Expected on a retry: the intent already committed and the guard aborted this
            // transaction. The transfer did NOT run again. This is a success, not a failure.
            if (isAlreadyCommitted(error)) {
                const classified = classifyError(error);
                line(
                    attempt,
                    'blocked',
                    `AlreadyCommitted (code ${classified.kind === 'commit-once' ? classified.code : '?'}) — ` +
                        'duplicate blocked, the transfer did not run a second time',
                );
                return { status: 'duplicate-blocked', attempts: attempt };
            }

            // A different failure entirely: the key was reused for a different payload
            // fingerprint. Retrying this unchanged would fail forever, and retrying it with a
            // new key would silently execute a second, different action. So stop and report.
            if (isIdempotencyConflict(error)) {
                const classified = classifyError(error);
                throw new Error(
                    `IdempotencyConflict (code ${classified.kind === 'commit-once' ? classified.code : '?'}): ` +
                        `key ${ORDER_ID} in namespace ${NAMESPACE} is already recorded for a different ` +
                        'payload fingerprint. This is not a duplicate of your intent — inspect the ' +
                        'receipt before doing anything else.',
                );
            }

            // Anything else is ambiguous: a timeout, an expired blockhash, or an error whose
            // cause we cannot see. We do not know whether the transaction landed, which is
            // precisely the situation CommitOnce exists for. Rebuild and let the guard decide.
            if (attempt === MAX_ATTEMPTS) {
                throw new Error(
                    `Gave up after ${MAX_ATTEMPTS} attempts. Last failure: ${describeAmbiguous(error)}`,
                );
            }
            const nextPriorityFee = priorityFeeMicroLamports * 2n;
            line(
                attempt,
                'retry',
                `${describeAmbiguous(error)} — rebuilding with fresh blockhash, ` +
                    `priorityFee ${priorityFeeMicroLamports} -> ${nextPriorityFee}µLamports, ` +
                    `idempotency key unchanged (${ORDER_ID})`,
            );
            priorityFeeMicroLamports = nextPriorityFee;
        }
    }
    throw new Error('unreachable: the attempt loop always returns or throws');
}

// ---------------------------------------------------------------------------------------
// Transaction lifetime narrowing
// ---------------------------------------------------------------------------------------

/**
 * The parameter type `sendAndConfirmTransactionFactory` actually accepts. Derived from the
 * factory rather than written out, so this keeps compiling if its requirements change.
 */
type ConfirmableTransaction = Parameters<ReturnType<typeof sendAndConfirmTransactionFactory>>[0];

/**
 * Narrow a signed transaction to the blockhash-lifetime variant.
 *
 * `signTransactionMessageWithSigners` declares its return type as the *union*
 * `TransactionWithLifetime` — blockhash or durable nonce — so the blockhash lifetime that
 * `setTransactionMessageLifetimeUsingBlockhash` established is erased before the value reaches
 * `sendAndConfirmTransactionFactory`, which requires the blockhash variant.
 *
 * Every transaction in this file sets a blockhash lifetime and nothing afterwards can change
 * that, so the narrowing is accurate. The runtime check keeps it honest rather than a blind
 * cast: if the lifetime were ever something else, this throws instead of sending a transaction
 * whose confirmation behaviour would be wrong. CommitOnce would reject such a transaction
 * anyway — a durable nonce cannot be combined with an expiring receipt, which is
 * `DurableNonceUnsupported`.
 */
function asBlockhashTransaction(
    signed: Awaited<ReturnType<typeof signTransactionMessageWithSigners>>,
): ConfirmableTransaction {
    if (!('lastValidBlockHeight' in signed.lifetimeConstraint)) {
        throw new Error(
            'CommitOnce example: expected a blockhash lifetime but got a durable-nonce ' +
                'transaction. CommitOnce rejects durable nonces when retention is not permanent.',
        );
    }
    return signed as ConfirmableTransaction;
}

// ---------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------

async function main(): Promise<void> {
    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
    const authority = await loadKeypairSigner(KEYPAIR_PATH);
    const commitOnce = createCommitOnceClient({ rpc });

    /**
     * The intent fingerprint: SEMANTIC content only.
     *
     * It contains the recipient, the amount, the memo and the order id — the things that
     * define *what the user asked for*. It deliberately does NOT contain the blockhash, the
     * priority fee, the compute budget, the signature, the retry counter or the submission
     * route. Every one of those changes when the transaction is rebuilt, so including any of
     * them would make attempt 2 look like a different intent: the guard would raise
     * IdempotencyConflict instead of AlreadyCommitted, and — far worse — a rebuilt retry would
     * be treated as a brand new action and execute a second time. That would defeat the
     * entire product.
     *
     * `undefined` is not allowed anywhere in here (the SDK throws rather than dropping a
     * property, because dropping one could make two different intents hash identically), which
     * is why the memo defaults to `null`.
     */
    const intent: CanonicalIntent = {
        action: 'sol-transfer',
        to: RECIPIENT,
        lamports: AMOUNT_LAMPORTS,
        memo: MEMO,
        orderId: ORDER_ID,
    };

    const guard = await commitOnce.prepare({
        authority: authority.address,
        namespace: NAMESPACE,
        idempotencyKey: ORDER_ID,
        intent,
        retention: RETENTION,
    });

    console.log('CommitOnce — guarded SOL transfer');
    console.log(`  rpc            ${RPC_URL}`);
    console.log(`  authority      ${authority.address}`);
    console.log(`  recipient      ${RECIPIENT}`);
    console.log(`  amount         ${AMOUNT_LAMPORTS} lamports`);
    console.log(`  namespace      ${NAMESPACE}`);
    console.log(`  idempotencyKey ${ORDER_ID}`);
    console.log(`  receipt PDA    ${guard.receipt}`);
    console.log(`  retention      ${guard.retentionSeconds}s`);
    console.log('');

    const balanceBefore = await rpc.getBalance(RECIPIENT, { commitment: 'confirmed' }).send();

    // Phase 1: the real submission, with retry.
    line(null, 'submit', `guarded transfer, up to ${MAX_ATTEMPTS} attempts`);
    const first = await submitGuardedTransfer({
        rpc,
        sendAndConfirm,
        commitOnce,
        authority,
        intent,
        label: 'phase 1',
    });

    // Phase 2: the same logical intent, deliberately submitted again as a rebuilt
    // transaction. This is what a naive client does after an ambiguous timeout, and it is the
    // case that double-sends without a guard.
    console.log('');
    line(null, 'replay', 'phase 2 — same intent, rebuilt transaction, same idempotency key');
    const replay = await submitGuardedTransfer({
        rpc,
        sendAndConfirm,
        commitOnce,
        authority,
        intent,
        label: 'phase 2',
    });

    const balanceAfter = await rpc.getBalance(RECIPIENT, { commitment: 'confirmed' }).send();
    const receiptStatus = await commitOnce.inspect({
        authority: authority.address,
        namespace: NAMESPACE,
        idempotencyKey: ORDER_ID,
        intent,
        clock: await commitOnce.fetchClock(),
    });

    console.log('');
    console.log('Result');
    console.log(`  phase 1            ${first.status} after ${first.attempts} attempt(s)`);
    console.log(`  phase 2            ${replay.status} after ${replay.attempts} attempt(s)`);
    console.log(`  recipient before   ${balanceBefore.value} lamports`);
    console.log(`  recipient after    ${balanceAfter.value} lamports`);
    console.log(
        `  delta              ${balanceAfter.value - balanceBefore.value} lamports ` +
            '(one transfer, not two)',
    );
    console.log(`  receipt status     ${receiptStatus.status}`);
    console.log(
        `  receipt matches    ${receiptStatus.status === 'unclaimed' ? 'n/a' : String(receiptStatus.matchesIntent)} ` +
            '(true means the stored fingerprint is this same intent)',
    );
    if (replay.status !== 'duplicate-blocked') {
        throw new Error(
            'Expected the replayed attempt to be blocked with AlreadyCommitted. It was not. ' +
                'Check that the CommitOnce program is deployed at ' +
                `${commitOnce.programAddress} on this cluster.`,
        );
    }
}

await main();
