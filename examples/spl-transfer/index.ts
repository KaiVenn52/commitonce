/**
 * CommitOnce example: a guarded SPL `TransferChecked`, with destination ATA creation.
 *
 * One atomic transaction contains, in this order:
 *
 *   [ commit_once::claim                        ]   the guard — FIRST
 *   [ Associated Token Program: CreateIdempotent]   destination ATA, created if absent
 *   [ SPL Token: TransferChecked                ]   the business instruction
 *   (plus a compute budget SetComputeUnitPrice, which is transport only)
 *
 * Ordering is deliberate and is the main lesson of this example. The guard goes first, so
 * that when the same intent is submitted twice the failure the caller sees is the guard's
 * `AlreadyCommitted` — a specific, actionable answer to "did this already happen?" — rather
 * than some incidental error from a later instruction (an ATA that already exists, a
 * delegate that is not set, and so on). Any instruction that can fail before the guard can
 * mask the guard's answer.
 *
 * The ATA creation uses the *idempotent* variant, because the destination's token account
 * may legitimately already exist — created by an earlier, unrelated transaction. The
 * non-idempotent variant would fail with "account already in use" in that case, for no
 * good reason.
 *
 * Run: see README.md in this directory, and run `setup-devnet.sh` first. This example HAS been
 * executed against devnet, against the deployed program; the raw output is in
 * `submission/evidence/devnet-spl-transfer-run.log`. The Jupiter-swap example has not.
 */

import { readFile } from 'node:fs/promises';

import {
    fetchMint,
    fetchMaybeToken,
    findAssociatedTokenPda,
    getCreateAssociatedTokenIdempotentInstructionAsync,
    getTransferCheckedInstruction,
    TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
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
    type Address,
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

const NAMESPACE = 'examples:spl-transfer';
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
const RPC_WS_URL = process.env.RPC_WS_URL ?? RPC_URL.replace(/^http/, 'ws');

const MINT = address(requireEnv('MINT'));
const RECIPIENT = address(requireEnv('RECIPIENT'));

/** Base units, i.e. whole tokens * 10^decimals. Read the mint below to confirm the scale. */
const AMOUNT_BASE_UNITS = BigInt(requireEnv('AMOUNT_BASE_UNITS'));

const ORDER_ID = process.env.ORDER_ID ?? 'order_928';
const MEMO = process.env.MEMO ?? null;

// ---------------------------------------------------------------------------------------
// Compute budget: the priority fee
// ---------------------------------------------------------------------------------------

const COMPUTE_BUDGET_PROGRAM_ADDRESS = address('ComputeBudget111111111111111111111111111111');

/**
 * ComputeBudget `SetComputeUnitPrice` (tag 3, u64 micro-lamports LE), hand-encoded because
 * this repository has no dependency on `@solana-program/compute-budget`. Replace it with
 * that package's `getSetComputeUnitPriceInstruction` if you add it — the bytes are the same.
 * See README.md, "Placeholders and unverified details".
 *
 * Transport only: it changes on every retry and must never enter the intent fingerprint.
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

function line(attempt: number | null, phase: string, detail: string): void {
    const stamp = (attempt === null ? '-' : String(attempt)).padEnd(3);
    console.log(`[attempt ${stamp}] ${phase.padEnd(9)} ${detail}`);
}

function describeAmbiguous(error: unknown): string {
    if (isSolanaError(error, SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED)) {
        return 'blockhash expired before confirmation';
    }
    if (isSolanaError(error, SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED)) {
        return 'identical signed bytes were already processed';
    }
    return error instanceof Error ? error.message : String(error);
}

/** Destination token balance, or `0n` when the account does not exist yet. */
async function tokenBalance(
    rpc: ReturnType<typeof createSolanaRpc>,
    account: Address,
): Promise<bigint> {
    const maybe = await fetchMaybeToken(rpc, account);
    return maybe.exists ? maybe.data.amount : 0n;
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
    readonly sourceAta: Address;
    readonly destinationAta: Address;
    readonly decimals: number;
    readonly intent: CanonicalIntent;
    readonly label: string;
};

async function submitGuardedTransfer(args: GuardedTransferArgs): Promise<SubmissionOutcome> {
    const {
        rpc,
        sendAndConfirm,
        commitOnce,
        authority,
        sourceAta,
        destinationAta,
        decimals,
        intent,
        label,
    } = args;
    let priorityFeeMicroLamports = BASE_PRIORITY_FEE_MICRO_LAMPORTS;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const { value: latestBlockhash } = await rpc
            .getLatestBlockhash({ commitment: 'confirmed' })
            .send();

        // Pure and byte-identical on every attempt: same authority, namespace, key and
        // intent always derive the same instruction and the same receipt PDA.
        const guard = await commitOnce.prepare({
            authority: authority.address,
            namespace: NAMESPACE,
            idempotencyKey: ORDER_ID,
            intent,
            retention: RETENTION,
        });

        // Created only if absent, and created by the *payer*: the authority pays the ATA rent
        // as well as the receipt deposit. `getCreateAssociatedTokenIdempotentInstructionAsync`
        // derives the ATA when `ata` is omitted, which is why it is asynchronous.
        const createDestinationAta = await getCreateAssociatedTokenIdempotentInstructionAsync({
            payer: authority,
            owner: RECIPIENT,
            mint: MINT,
        });

        const transferChecked = getTransferCheckedInstruction({
            source: sourceAta,
            mint: MINT,
            destination: destinationAta,
            // Passing the signer (not its address) puts the signature requirement in the
            // instruction's account meta, so `signTransactionMessageWithSigners` finds it.
            authority,
            amount: AMOUNT_BASE_UNITS,
            // TransferChecked carries the expected decimals so a mint with different decimals
            // than the client assumed fails here instead of silently moving a wrong amount.
            decimals,
        });

        const message = pipe(
            createTransactionMessage({ version: 0 }),
            (m) => setTransactionMessageFeePayerSigner(authority, m),
            (m) =>
                appendTransactionMessageInstructions(
                    [
                        setComputeUnitPriceInstruction(priorityFeeMicroLamports),
                        // Guard first. See the file header for why the ordering matters.
                        guard.instruction,
                        createDestinationAta,
                        transferChecked,
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
            if (isAlreadyCommitted(error)) {
                const classified = classifyError(error);
                line(
                    attempt,
                    'blocked',
                    `AlreadyCommitted (code ${classified.kind === 'commit-once' ? classified.code : '?'}) — ` +
                        'duplicate blocked, no ATA rent paid and no tokens moved',
                );
                return { status: 'duplicate-blocked', attempts: attempt };
            }

            if (isIdempotencyConflict(error)) {
                const classified = classifyError(error);
                throw new Error(
                    `IdempotencyConflict (code ${classified.kind === 'commit-once' ? classified.code : '?'}): ` +
                        `key ${ORDER_ID} in namespace ${NAMESPACE} is already recorded for a different ` +
                        'payload fingerprint. This is not a duplicate of your intent — inspect the ' +
                        'receipt before doing anything else.',
                );
            }

            // Ambiguous: timeout, expired blockhash, or an error we cannot interpret. We do
            // not know whether it landed, so rebuild and let the guard answer that question.
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

    // Decimals come from the mint itself rather than from an environment variable, so a
    // mistyped scale cannot turn 1.5 tokens into 1500000.
    const mintAccount = await fetchMint(rpc, MINT);
    const decimals = mintAccount.data.decimals;

    const [sourceAta] = await findAssociatedTokenPda({
        owner: authority.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        mint: MINT,
    });
    const [destinationAta] = await findAssociatedTokenPda({
        owner: RECIPIENT,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        mint: MINT,
    });

    /**
     * The intent fingerprint: SEMANTIC content only — who, how much, which mint, which order.
     *
     * Not the blockhash, not the priority fee, not the compute budget, not the signature, not
     * the retry counter, not the submission route. All of those change when a transaction is
     * rebuilt, so including any of them would make a retry look like a different intent: the
     * guard would answer `IdempotencyConflict` instead of `AlreadyCommitted`, and a rebuilt
     * retry would be treated as a new action and could move the tokens a second time.
     *
     * `undefined` is rejected by the SDK's encoder (dropping a property could make two
     * different intents hash identically), so the optional memo is `null` rather than omitted.
     */
    const intent: CanonicalIntent = {
        action: 'spl-transfer-checked',
        mint: MINT,
        to: RECIPIENT,
        amountBaseUnits: AMOUNT_BASE_UNITS,
        decimals,
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

    console.log('CommitOnce — guarded SPL TransferChecked');
    console.log(`  rpc              ${RPC_URL}`);
    console.log(`  authority        ${authority.address}`);
    console.log(`  mint             ${MINT} (decimals ${decimals})`);
    console.log(`  recipient        ${RECIPIENT}`);
    console.log(`  amount           ${AMOUNT_BASE_UNITS} base units`);
    console.log(`  source ATA       ${sourceAta}`);
    console.log(`  destination ATA  ${destinationAta}`);
    console.log(`  namespace        ${NAMESPACE}`);
    console.log(`  idempotencyKey   ${ORDER_ID}`);
    console.log(`  receipt PDA      ${guard.receipt}`);
    console.log(`  retention        ${guard.retentionSeconds}s`);
    console.log('');
    console.log('Instruction order in the guarded transaction:');
    console.log('  0. compute budget  SetComputeUnitPrice   (transport only)');
    console.log('  1. commit_once     claim                 (the guard)');
    console.log('  2. ATA program     CreateIdempotent      (destination ATA, if absent)');
    console.log('  3. SPL Token       TransferChecked       (the business instruction)');
    console.log('');

    const destinationBefore = await tokenBalance(rpc, destinationAta);
    const sourceBefore = await tokenBalance(rpc, sourceAta);
    if (sourceBefore < AMOUNT_BASE_UNITS) {
        throw new Error(
            `Source token account ${sourceAta} holds ${sourceBefore} base units, less than the ` +
                `${AMOUNT_BASE_UNITS} this transfer needs. Fund it first.`,
        );
    }

    line(null, 'submit', `guarded transfer, up to ${MAX_ATTEMPTS} attempts`);
    const first = await submitGuardedTransfer({
        rpc,
        sendAndConfirm,
        commitOnce,
        authority,
        sourceAta,
        destinationAta,
        decimals,
        intent,
        label: 'phase 1',
    });

    console.log('');
    line(null, 'replay', 'phase 2 — same intent, rebuilt transaction, same idempotency key');
    const replay = await submitGuardedTransfer({
        rpc,
        sendAndConfirm,
        commitOnce,
        authority,
        sourceAta,
        destinationAta,
        decimals,
        intent,
        label: 'phase 2',
    });

    const destinationAfter = await tokenBalance(rpc, destinationAta);
    const sourceAfter = await tokenBalance(rpc, sourceAta);
    const receiptStatus = await commitOnce.inspect({
        authority: authority.address,
        namespace: NAMESPACE,
        idempotencyKey: ORDER_ID,
        intent,
        clock: await commitOnce.fetchClock(),
    });

    console.log('');
    console.log('Result');
    console.log(`  phase 1               ${first.status} after ${first.attempts} attempt(s)`);
    console.log(`  phase 2               ${replay.status} after ${replay.attempts} attempt(s)`);
    console.log(`  source before/after   ${sourceBefore} -> ${sourceAfter}`);
    console.log(`  destination before    ${destinationBefore}`);
    console.log(`  destination after     ${destinationAfter}`);
    console.log(
        `  delta                 ${destinationAfter - destinationBefore} base units ` +
            '(one transfer, not two)',
    );
    console.log(`  receipt status        ${receiptStatus.status}`);
    console.log(
        `  receipt matches       ${receiptStatus.status === 'unclaimed' ? 'n/a' : String(receiptStatus.matchesIntent)} ` +
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
