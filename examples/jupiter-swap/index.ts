/**
 * CommitOnce example: guarding an already-built third-party swap transaction (Jupiter-shaped).
 *
 * ## Read this first
 *
 * This example is **structural**. It has NOT been run against Jupiter's live API, and it does
 * not contain a Jupiter endpoint, request shape, quote format or instruction layout, because
 * those are Jupiter's to define and this repository does not know them. Inventing them would
 * produce code that looks authoritative and is wrong.
 *
 * What it does show, correctly and completely, is the part that is CommitOnce's business:
 * given a serialized transaction that somebody else built, how do you prepend the guard and
 * submit it? The input comes from the environment:
 *
 *   JUPITER_SWAP_TX        the base64-encoded serialized transaction
 *   JUPITER_SWAP_TX_FILE   or a path to a file containing that base64 string
 *
 * Producing that value is the reader's job: call the swap API you actually use (Jupiter's
 * current HTTP API, their SDK, or any other aggregator) with your own HTTP client and pass
 * the base64 transaction it returns. See README.md, "Placeholders and unverified details".
 *
 * ## The mechanism
 *
 *   1. Decode the base64 transaction and decompile its message, resolving address lookup
 *      tables from the cluster.
 *   2. Prepend `commit_once::claim` to the message's existing instructions. The swap
 *      instructions are not modified, reordered or reinterpreted — they are simply no longer
 *      first.
 *   3. Re-sign. Prepending an instruction changes the message, which invalidates every
 *      existing signature: the transaction returned by the swap API cannot be sent as-is any
 *      more, and every required signer (including your wallet) must sign again. That is
 *      expected and unavoidable.
 *   4. Submit. If the receipt already exists, `claim` errors and the swap does not execute.
 *
 * Run: see README.md in this directory. This example has not been executed against a live
 * cluster.
 */

import { readFile } from 'node:fs/promises';

import {
    address,
    appendTransactionMessageInstructions,
    createKeyPairSignerFromBytes,
    createSolanaRpc,
    createSolanaRpcSubscriptions,
    createTransactionMessage,
    getBase64Encoder,
    getCompiledTransactionMessageDecoder,
    getSignatureFromTransaction,
    getTransactionDecoder,
    isSolanaError,
    prependTransactionMessageInstruction,
    sendAndConfirmTransactionFactory,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED,
    SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED,
    decompileTransactionMessageFetchingLookupTables,
    pipe,
    type Instruction,
    type KeyPairSigner,
    type TransactionMessage,
} from '@solana/kit';
import {
    bytesToHex,
    classifyError,
    createCommitOnceClient,
    isAlreadyCommitted,
    isIdempotencyConflict,
    sha256,
    type CanonicalIntent,
    type CommitOnceClient,
} from '@commitonce/solana';

// ---------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------

const NAMESPACE = 'examples:jupiter-swap';

/**
 * Retention is per claim. A swap guarded for 24 hours cannot be re-executed for 24 hours with
 * the same key — which is the point, and also the reason not to make it arbitrarily long:
 * a permanent receipt costs its rent deposit forever (1,676,400 lamports at mainnet rates).
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

const ORDER_ID = process.env.ORDER_ID ?? 'order_928';

/**
 * The swap's *semantic* parameters. These come from your own request, not from the returned
 * transaction — see the comment on `intent` below for why that distinction is the whole
 * product.
 */
const INPUT_MINT = address(requireEnv('INPUT_MINT'));
const OUTPUT_MINT = address(requireEnv('OUTPUT_MINT'));
const AMOUNT_BASE_UNITS = BigInt(requireEnv('AMOUNT_BASE_UNITS'));
const SLIPPAGE_BPS = process.env.SLIPPAGE_BPS === undefined ? null : Number(process.env.SLIPPAGE_BPS);
const MEMO = process.env.MEMO ?? null;

/**
 * PLACEHOLDER — deliberately not a call to Jupiter.
 *
 * Fetching a swap transaction requires knowing the aggregator's current HTTP API: its host,
 * its paths, its request body, its quote shape and how it wants the priority fee expressed.
 * None of that is stable knowledge this repository can assert, so this function does not
 * guess. Supply the base64 transaction instead, from whatever client you already use.
 *
 * A real integration replaces this whole function with a single call to the swap API, and
 * re-invokes it on every attempt so that each attempt gets a fresh quote, a fresh blockhash
 * and a fresh priority fee.
 */
async function loadSwapTransactionBase64(): Promise<string> {
    const inline = process.env.JUPITER_SWAP_TX;
    if (inline !== undefined && inline.trim() !== '') {
        return inline.trim();
    }
    const fromFile = process.env.JUPITER_SWAP_TX_FILE;
    if (fromFile !== undefined && fromFile.trim() !== '') {
        return (await readFile(fromFile.trim(), 'utf8')).trim();
    }
    throw new Error(
        'CommitOnce example: no swap transaction supplied. Set JUPITER_SWAP_TX to the ' +
            'base64-encoded serialized transaction, or JUPITER_SWAP_TX_FILE to a file ' +
            'containing it. This example does not call Jupiter itself — see README.md.',
    );
}

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
 * Caveat specific to this example: if the supplied transaction already contains its own
 * SetComputeUnitPrice, that one takes effect, because the *last* such instruction in a
 * transaction wins and ours is prepended. Raising the fee for a swap therefore belongs in the
 * swap API's own priority-fee parameter, not here.
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

/** One line per instruction, for showing what is in the transaction and in what order. */
function describeInstructions(message: TransactionMessage): string[] {
    return message.instructions.map((instruction, index) => {
        const accounts = instruction.accounts?.length ?? 0;
        const bytes = instruction.data?.length ?? 0;
        return `    [${index}] program=${instruction.programAddress} accounts=${accounts} data=${bytes}B`;
    });
}

// ---------------------------------------------------------------------------------------
// Decode the supplied transaction
// ---------------------------------------------------------------------------------------

type DecodedSwap = {
    /** The message, with address lookup tables already resolved. */
    readonly message: TransactionMessage & { readonly feePayer: { readonly address: string } };
    readonly base64: string;
    readonly originalInstructionCount: number;
    /** Diagnostic only — never part of the intent fingerprint. */
    readonly transactionDigest: string;
};

async function decodeSwapTransaction(
    base64: string,
    rpc: ReturnType<typeof createSolanaRpc>,
): Promise<DecodedSwap> {
    const bytes = getBase64Encoder().encode(base64) as Uint8Array;
    const transaction = getTransactionDecoder().decode(bytes);
    const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);

    // Address lookup tables have to be resolved against the cluster before the message can be
    // edited: a compiled v0 message refers to accounts by table index, and an instruction
    // cannot be prepended without knowing what those indexes mean.
    const message = await decompileTransactionMessageFetchingLookupTables(compiled, rpc);

    // A durable-nonce transaction never expires, so a finite receipt window would be
    // meaningless for it: cleanup could reopen the duplicate window while an old signed
    // duplicate is still executable. The program rejects that combination with
    // DurableNonceUnsupported (6002) unless retention is 'permanent'.
    if (!('blockhash' in message.lifetimeConstraint)) {
        throw new Error(
            'CommitOnce example: the supplied transaction uses a durable nonce, not a blockhash ' +
                'lifetime. The CommitOnce program rejects nonce transactions with a finite ' +
                "retention window. Use retention: 'permanent' if you really need a nonce " +
                'transaction, or re-quote the swap with a blockhash lifetime.',
        );
    }

    return {
        message,
        base64,
        originalInstructionCount: message.instructions.length,
        transactionDigest: bytesToHex(await sha256(bytes)),
    };
}

// ---------------------------------------------------------------------------------------
// The guarded submission
// ---------------------------------------------------------------------------------------

type SubmissionOutcome =
    | {
          readonly status: 'committed';
          readonly signature: string;
          readonly attempts: number;
          readonly instructionLines: string[];
      }
    | { readonly status: 'duplicate-blocked'; readonly attempts: number };

type GuardedSwapArgs = {
    readonly rpc: ReturnType<typeof createSolanaRpc>;
    readonly sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>;
    readonly commitOnce: CommitOnceClient;
    readonly authority: KeyPairSigner;
    readonly swap: DecodedSwap;
    readonly intent: CanonicalIntent;
    readonly label: string;
};

async function submitGuardedSwap(args: GuardedSwapArgs): Promise<SubmissionOutcome> {
    const { rpc, sendAndConfirm, commitOnce, authority, swap, intent, label } = args;
    let priorityFeeMicroLamports = BASE_PRIORITY_FEE_MICRO_LAMPORTS;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const { value: latestBlockhash } = await rpc
            .getLatestBlockhash({ commitment: 'confirmed' })
            .send();

        // Pure: no RPC, no prover, no indexer. Identical bytes on every attempt.
        const guard = await commitOnce.prepare({
            authority: authority.address,
            namespace: NAMESPACE,
            idempotencyKey: ORDER_ID,
            intent,
            retention: RETENTION,
        });

        // The guard requires `authority` to sign, so the fee payer must be that same signer
        // here. A relayer that pays the fee instead would make this a two-signer transaction.
        // Checked against the swap's own message, before we replace its fee payer below.
        if (swap.message.feePayer.address !== authority.address) {
            throw new Error(
                `CommitOnce example: the supplied transaction is paid for by ${swap.message.feePayer.address}, ` +
                    `but this example signs with ${authority.address}. The guard's authority must ` +
                    'sign, so either supply a transaction fee-paid by that key or extend this ' +
                    'example to collect both signatures.',
            );
        }

        // Prepend, never reorder: the swap's own instructions keep their relative order and
        // their contents. Prepending is two passes so that the compute budget instruction
        // ends up before the guard rather than after it.
        //
        // The message is rebuilt rather than mutated in place. Jupiter's decoder types the fee
        // payer address as a plain `string`, while kit brands addresses as `Address`, so
        // `setTransactionMessageFeePayerSigner` cannot be applied to the decoded message
        // directly. Rebuilding is lossless here because
        // `decompileTransactionMessageFetchingLookupTables` has already resolved every address
        // lookup table: the instruction list is complete and self-contained, so the rebuilt
        // message carries the same instructions in the same order, with our own fee payer.
        const message = pipe(
            createTransactionMessage({ version: 0 }),
            (m) => setTransactionMessageFeePayerSigner(authority, m),
            // Rebuild the lifetime on every attempt. A retry must not carry the blockhash the
            // swap API computed minutes ago: an expired blockhash fails before the guard is
            // ever reached, so a stale lifetime turns retries into guaranteed failures.
            // In a real integration this step is where a fresh quote also arrives.
            (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
            (m) => appendTransactionMessageInstructions(swap.message.instructions, m),
            (m) => prependTransactionMessageInstruction(guard.instruction, m),
            (m) => prependTransactionMessageInstruction(setComputeUnitPriceInstruction(priorityFeeMicroLamports), m),
        );

        const transaction = asBlockhashTransaction(await signTransactionMessageWithSigners(message));
        const signature = getSignatureFromTransaction(transaction);
        const instructionLines = describeInstructions(message);

        line(
            attempt,
            'send',
            `${label} blockhash=${latestBlockhash.blockhash.slice(0, 8)}… ` +
                `priorityFee=${priorityFeeMicroLamports}µLamports sig=${signature.slice(0, 8)}… ` +
                `instructions=${message.instructions.length} ` +
                `(${swap.originalInstructionCount} swap + guard + compute budget)`,
        );

        try {
            await sendAndConfirm(transaction, { commitment: 'confirmed' });
            line(attempt, 'committed', `signature=${signature}`);
            return { status: 'committed', signature, attempts: attempt, instructionLines };
        } catch (error) {
            if (isAlreadyCommitted(error)) {
                const classified = classifyError(error);
                line(
                    attempt,
                    'blocked',
                    `AlreadyCommitted (code ${classified.kind === 'commit-once' ? classified.code : '?'}) — ` +
                        'duplicate blocked, the swap did not execute a second time',
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

            // Ambiguous: a timeout, an expired blockhash, or an uninterpretable error. We do
            // not know whether the swap landed. Rebuild with a fresh blockhash and a higher
            // priority fee, keeping the same idempotency key, and let the guard decide.
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

    const swap = await decodeSwapTransaction(await loadSwapTransactionBase64(), rpc);

    /**
     * The intent fingerprint: the swap the user asked for.
     *
     * Deliberately built from the *request* — input mint, output mint, amount, slippage, order
     * id — and never from the returned transaction. Not from its bytes, not from its
     * instruction list, not from its blockhash, not from its priority fee, not from the retry
     * counter.
     *
     * This is the trap this example exists to make visible: a swap API returns a *different*
     * transaction on every quote — different blockhash, different route, different intermediate
     * accounts, different compute budget — while the user's intent ("swap 100 USDC for at least
     * 0.5 SOL, order 928") is unchanged. Fingerprinting the transaction bytes would make every
     * re-quote look like a brand new intent, so the guard would report IdempotencyConflict
     * instead of AlreadyCommitted, and a rebuilt retry would be treated as a second swap. That
     * would defeat the entire product.
     *
     * The transaction digest printed below is a diagnostic. It is not in this object.
     */
    const intent: CanonicalIntent = {
        action: 'jupiter-swap',
        inputMint: INPUT_MINT,
        outputMint: OUTPUT_MINT,
        amountBaseUnits: AMOUNT_BASE_UNITS,
        slippageBps: SLIPPAGE_BPS,
        orderId: ORDER_ID,
        memo: MEMO,
    };

    const guard = await commitOnce.prepare({
        authority: authority.address,
        namespace: NAMESPACE,
        idempotencyKey: ORDER_ID,
        intent,
        retention: RETENTION,
    });

    console.log('CommitOnce — guarded third-party swap transaction (structural example)');
    console.log(`  rpc              ${RPC_URL}`);
    console.log(`  authority        ${authority.address}`);
    console.log(`  namespace        ${NAMESPACE}`);
    console.log(`  idempotencyKey   ${ORDER_ID}`);
    console.log(`  receipt PDA      ${guard.receipt}`);
    console.log(`  retention        ${guard.retentionSeconds}s`);
    console.log('');
    console.log(`  supplied tx      ${swap.base64.length} base64 chars, ` +
        `${swap.originalInstructionCount} instruction(s)`);
    console.log(`  tx digest        ${swap.transactionDigest}`);
    console.log('                   (diagnostic only — NOT part of the intent fingerprint)');
    console.log(`  fee payer        ${swap.message.feePayer.address}`);
    console.log('');
    console.log('Instructions in the supplied transaction:');
    for (const l of describeInstructions(swap.message)) {
        console.log(l);
    }
    console.log('');

    line(null, 'submit', `guarded swap, up to ${MAX_ATTEMPTS} attempts`);
    const first = await submitGuardedSwap({
        rpc,
        sendAndConfirm,
        commitOnce,
        authority,
        swap,
        intent,
        label: 'phase 1',
    });

    if (first.status === 'committed') {
        console.log('');
        console.log('Instructions actually submitted (guard first, swap unchanged):');
        for (const l of first.instructionLines) {
            console.log(l);
        }
    }

    console.log('');
    line(null, 'replay', 'phase 2 — same intent, rebuilt transaction, same idempotency key');
    const replay = await submitGuardedSwap({
        rpc,
        sendAndConfirm,
        commitOnce,
        authority,
        swap,
        intent,
        label: 'phase 2',
    });

    const receiptStatus = await commitOnce.inspect({
        authority: authority.address,
        namespace: NAMESPACE,
        idempotencyKey: ORDER_ID,
        intent,
        clock: await commitOnce.fetchClock(),
    });

    console.log('');
    console.log('Result');
    console.log(`  phase 1          ${first.status} after ${first.attempts} attempt(s)`);
    console.log(`  phase 2          ${replay.status} after ${replay.attempts} attempt(s)`);
    console.log(`  receipt status   ${receiptStatus.status}`);
    console.log(
        `  receipt matches  ${receiptStatus.status === 'unclaimed' ? 'n/a' : String(receiptStatus.matchesIntent)} ` +
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
