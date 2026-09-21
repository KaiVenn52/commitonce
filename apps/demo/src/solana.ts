/**
 * RPC plumbing: build, sign, submit, confirm, and read back.
 *
 * Three choices here are load-bearing for the demo, and each is explained where it is made:
 *
 *   1. Every transaction is submitted with `skipPreflight: true`. The retry that is
 *      *supposed* to fail has to actually land onchain, otherwise it would have no
 *      signature, no explorer page, and no program logs — and the whole point of the demo
 *      is that the failure is real and inspectable.
 *   2. Confirmation is polled rather than subscribed. A websocket subscription would add a
 *      second moving part to a demo whose only job is to be believed.
 *   3. The blockhash used for a rebuilt attempt is polled until it differs from the previous
 *      attempt's. On devnet, two consecutive `getLatestBlockhash` calls inside one slot
 *      return the same value; without this wait, "rebuilt" would be a lie.
 */

import {
    appendTransactionMessageInstructions,
    createDefaultRpcTransport,
    createSolanaRpc,
    createSolanaRpcFromTransport,
    createTransactionMessage,
    getBase64EncodedWireTransaction,
    getSignatureFromTransaction,
    isSolanaError,
    pipe,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
    address,
    type Address,
    type Blockhash,
    type Instruction,
    type KeyPairSigner,
    type RpcResponse,
    type Signature,
    type Slot,
} from '@solana/kit';

/** Devnet, because that is where the two programs are deployed and verified. */
export const DEFAULT_RPC_URL = 'https://api.devnet.solana.com';

/** The Compute Budget program, whose `SetComputeUnitPrice` is how a client raises its fee. */
export const COMPUTE_BUDGET_PROGRAM_ADDRESS: Address = address(
    'ComputeBudget111111111111111111111111111111',
);

export type DemoRpc = ReturnType<typeof createSolanaRpc>;

/** Derived rather than imported, so this file does not depend on which package re-exports it. */
type Transport = Parameters<typeof createSolanaRpcFromTransport>[0];

/**
 * How many times a rate-limited or flaky RPC call is retried before the demo gives up.
 */
const RPC_ATTEMPTS = 6;

/** Exponential backoff with jitter: long enough to clear a rate limit, short enough to stay fast. */
function retryDelayMs(attempt: number): number {
    const ceiling = Math.min(250 * 2 ** attempt, 3_000);
    return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

/**
 * Whether an RPC failure is worth retrying.
 *
 * The devnet public endpoint is shared and rate limited, and this demo polls for
 * confirmation, so a bare `429` would otherwise abort a run halfway through — after scenario A
 * had already spent SOL and produced signatures. Retrying is safe here for a specific reason:
 * every call this demo makes is either a read or a resubmission of an already-signed
 * transaction, and the network deduplicates a resubmitted transaction by message hash.
 */
function isRetryableRpcFailure(error: unknown): boolean {
    if (isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
        const { statusCode } = error.context;
        return statusCode === 408 || statusCode === 429 || statusCode >= 500;
    }
    const message = error instanceof Error ? error.message : String(error);
    return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|other side closed/i.test(
        message,
    );
}

/**
 * Build the RPC client this demo uses.
 *
 * This follows the retrying-transport pattern @solana/kit documents, rather than wrapping
 * every call site: the retry belongs to the transport, so no individual RPC call can forget
 * to apply it.
 */
export function createRpc(url: string): DemoRpc {
    const transport = createDefaultRpcTransport({ url });

    const withRetries: Transport = async <TResponse>(
        ...args: Parameters<Transport>
    ): Promise<RpcResponse<TResponse>> => {
        let lastError: unknown;
        for (let attempt = 0; attempt < RPC_ATTEMPTS; attempt += 1) {
            try {
                return await transport<TResponse>(...args);
            } catch (error) {
                lastError = error;
                if (!isRetryableRpcFailure(error) || attempt === RPC_ATTEMPTS - 1) {
                    throw error;
                }
                await sleep(retryDelayMs(attempt));
            }
        }
        throw lastError;
    };

    return createSolanaRpcFromTransport(withRetries) as unknown as DemoRpc;
}


/**
 * `SetComputeUnitPrice` — Compute Budget enum variant 3, followed by a little-endian u64.
 *
 * Hand-encoded because the workspace has no `@solana-program/compute-budget` dependency, and
 * because it makes the point that this instruction is pure transport: it changes the
 * transaction's bytes, and therefore its message hash, and therefore whether Solana's own
 * deduplication can recognise the retry. It carries no semantic content.
 */
export function createSetComputeUnitPriceInstruction(microLamports: bigint): Instruction {
    const data = new Uint8Array(9);
    data[0] = 3;
    new DataView(data.buffer).setBigUint64(1, microLamports, true);
    // No accounts: the compute budget program only reads the price out of the instruction data.
    return {
        programAddress: COMPUTE_BUDGET_PROGRAM_ADDRESS,
        accounts: [],
        data,
    };
}

export type BlockhashLifetime = {
    readonly blockhash: Blockhash;
    readonly lastValidBlockHeight: Slot;
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/** Read the current blockhash at `confirmed`. */
export async function fetchBlockhash(rpc: DemoRpc): Promise<BlockhashLifetime> {
    const { value } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
    return { blockhash: value.blockhash, lastValidBlockHeight: value.lastValidBlockHeight };
}

export type FreshBlockhash = {
    readonly lifetime: BlockhashLifetime;
    /** How long the demo had to wait for the cluster to move on. */
    readonly waitedMs: number;
    /** The blockhash this one replaces, or `null` for the first attempt of a scenario. */
    readonly replaced: string | null;
};

/**
 * Wait until the cluster offers a blockhash different from `previous`.
 *
 * This is the mechanical half of "rebuilt". A retry that reused the previous blockhash
 * would produce byte-identical message content apart from the priority fee, and a demo
 * about message-hash deduplication should not leave that to chance.
 */
export async function fetchFreshBlockhash(
    rpc: DemoRpc,
    previous: string | null,
    options: { readonly timeoutMs?: number; readonly pollMs?: number } = {},
): Promise<FreshBlockhash> {
    const timeoutMs = options.timeoutMs ?? 25_000;
    const pollMs = options.pollMs ?? 800;
    const startedAt = Date.now();

    for (;;) {
        const lifetime = await fetchBlockhash(rpc);
        if (previous === null || lifetime.blockhash !== previous) {
            return { lifetime, waitedMs: Date.now() - startedAt, replaced: previous };
        }
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error(
                `CommitOnce demo: the cluster kept returning the same blockhash (${previous}) for ` +
                    `${timeoutMs}ms. A rebuilt attempt needs a different blockhash, so the demo ` +
                    `refuses to continue and pretend the retry was rebuilt. Retry in a moment, or ` +
                    `point --rpc at a healthier endpoint.`,
            );
        }
        await sleep(pollMs);
    }
}

/** Build, fee-pay and sign a v0 transaction. */
export async function buildSignedTransaction(args: {
    readonly feePayer: KeyPairSigner;
    readonly instructions: readonly Instruction[];
    readonly lifetime: BlockhashLifetime;
}): Promise<Awaited<ReturnType<typeof signTransactionMessageWithSigners>>> {
    const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(args.feePayer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(args.lifetime, m),
        (m) => appendTransactionMessageInstructions(args.instructions, m),
    );
    return signTransactionMessageWithSigners(message);
}

export type SubmitResult = {
    readonly signature: Signature;
    readonly slot: Slot | null;
    /** `true` when the transaction was included in a block and the runtime rejected it. */
    readonly failed: boolean;
    /** The raw `err` value the cluster reported, suitable for `classifyError`. */
    readonly transactionError: unknown;
    readonly logs: readonly string[];
    readonly computeUnitsConsumed: bigint | null;
    readonly fee: bigint | null;
};

function toBigIntOrNull(value: unknown): bigint | null {
    if (typeof value === 'bigint') {
        return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return BigInt(Math.trunc(value));
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
        return BigInt(value);
    }
    return null;
}

/**
 * Submit a signed transaction and wait until the cluster has confirmed it — successfully or
 * not. A confirmed failure is a normal return value here, not an exception: for this demo,
 * "the guard rejected the retry" is the expected result and must be printed with its
 * signature and its logs.
 */
export async function submitAndConfirm(
    rpc: DemoRpc,
    signed: Awaited<ReturnType<typeof signTransactionMessageWithSigners>>,
    options: { readonly timeoutMs?: number; readonly pollMs?: number; readonly cluster?: string } = {},
): Promise<SubmitResult> {
    const timeoutMs = options.timeoutMs ?? 40_000;
    const pollMs = options.pollMs ?? 800;
    const cluster = options.cluster ?? 'devnet';
    const signature = getSignatureFromTransaction(signed);

    await rpc
        .sendTransaction(getBase64EncodedWireTransaction(signed), {
            encoding: 'base64',
            // See the module comment: without this, a transaction that is expected to fail
            // would be rejected during simulation and never reach a block.
            skipPreflight: true,
            maxRetries: 3n,
            preflightCommitment: 'confirmed',
        })
        .send();

    const startedAt = Date.now();
    let err: unknown = null;
    let confirmed = false;

    while (!confirmed) {
        const { value } = await rpc
            .getSignatureStatuses([signature], { searchTransactionHistory: true })
            .send();
        const status = value[0];
        if (status !== null && status !== undefined) {
            err = status.err ?? null;
            if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
                confirmed = true;
                break;
            }
        }
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error(
                `CommitOnce demo: transaction ${signature} was submitted but never confirmed within ` +
                    `${timeoutMs}ms. It may have been dropped (the blockhash could have expired, or the ` +
                    `leader missed it). Inspect it at ` +
                    `${explorerTxUrl(signature, cluster)} before re-running.`,
            );
        }
        await sleep(pollMs);
    }

    // Fetch the full transaction for the program logs. The status endpoint reports *that* it
    // failed; only the logs say *why*, and an honest demo prints them.
    let detail: Awaited<ReturnType<ReturnType<DemoRpc['getTransaction']>['send']>> | null = null;
    for (let attempt = 0; attempt < 12 && detail === null; attempt += 1) {
        detail = await rpc
            .getTransaction(signature, {
                encoding: 'json',
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
            })
            .send();
        if (detail === null) {
            await sleep(250);
        }
    }

    const meta = detail?.meta ?? null;

    return {
        signature,
        slot: detail?.slot ?? null,
        failed: err !== null,
        transactionError: err,
        logs: meta?.logMessages ?? [],
        computeUnitsConsumed: toBigIntOrNull(meta?.computeUnitsConsumed),
        fee: toBigIntOrNull(meta?.fee),
    };
}

/** Read a lamport balance at `confirmed`. */
export async function fetchLamportBalance(rpc: DemoRpc, owner: Address): Promise<bigint> {
    const { value } = await rpc.getBalance(owner, { commitment: 'confirmed' }).send();
    return value;
}

/**
 * Submit many signed transactions at once, then confirm them with **one** batched poll.
 *
 * This exists because the per-transaction path in {@link submitAndConfirm} does not scale to a
 * contention test. Five concurrent transactions means five concurrent `getSignatureStatuses`
 * polling loops, and the public devnet endpoint rate-limits per method — the first run of the
 * contention script died with HTTP 429 and `x-ratelimit-endpoint-remaining: -1821`.
 *
 * Three things make this gentler without weakening the test:
 *
 *   1. Every transaction is sent in the same tick, which is the whole point — they must reach
 *      the leader together to have a chance of sharing a slot.
 *   2. Confirmation is polled with a single `getSignatureStatuses` call carrying every
 *      signature, instead of one call per transaction.
 *   3. A 429 on send is retried with the server's own `retry-after` honoured, because losing
 *      one attempt to a rate limit would silently turn a five-way race into a four-way one.
 */
export async function submitManyAndConfirm(
    rpc: DemoRpc,
    signed: readonly Awaited<ReturnType<typeof signTransactionMessageWithSigners>>[],
    options: { readonly timeoutMs?: number; readonly pollMs?: number; readonly cluster?: string } = {},
): Promise<SubmitResult[]> {
    const timeoutMs = options.timeoutMs ?? 90_000;
    const pollMs = options.pollMs ?? 1_500;
    const cluster = options.cluster ?? 'devnet';

    const signatures = signed.map((transaction) => getSignatureFromTransaction(transaction));

    // ---------------------------------------------------------------------------------
    // Phase 1: send everything at once.
    // ---------------------------------------------------------------------------------
    await Promise.all(
        signed.map(async (transaction, index) => {
            const base64 = getBase64EncodedWireTransaction(transaction);
            const signature = signatures[index]!;
            let lastError: unknown = null;
            for (let attempt = 0; attempt < 8; attempt += 1) {
                try {
                    await rpc
                        .sendTransaction(base64, {
                            encoding: 'base64',
                            skipPreflight: true,
                            maxRetries: 3n,
                            preflightCommitment: 'confirmed',
                        })
                        .send();
                    return;
                } catch (error) {
                    lastError = error;
                    if (!isRateLimitError(error)) {
                        throw error;
                    }
                    // The endpoint is shared and rate limited. Wait it out rather than drop the
                    // attempt, because a dropped attempt would make the race smaller than claimed.
                    await sleep(retryAfterMs(error, attempt));
                }
            }
            throw new Error(
                `CommitOnce: could not submit ${signature} after 8 attempts; the RPC endpoint kept ` +
                    `rate limiting us. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
            );
        }),
    );

    // ---------------------------------------------------------------------------------
    // Phase 2: one batched poll for every signature.
    // ---------------------------------------------------------------------------------
    const startedAt = Date.now();
    const errors: unknown[] = signatures.map(() => null);
    let pending = new Set(signatures.map((_signature, index) => index));

    while (pending.size > 0) {
        const { value } = await rpc
            .getSignatureStatuses(signatures, { searchTransactionHistory: true })
            .send();
        for (const index of [...pending]) {
            const status = value[index];
            if (status === null || status === undefined) {
                continue;
            }
            if (
                status.confirmationStatus === 'confirmed' ||
                status.confirmationStatus === 'finalized'
            ) {
                errors[index] = status.err ?? null;
                pending.delete(index);
            }
        }
        if (pending.size === 0) {
            break;
        }
        if (Date.now() - startedAt > timeoutMs) {
            const missing = [...pending].map((index) => signatures[index]).join(', ');
            throw new Error(
                `CommitOnce: ${pending.size} of ${signatures.length} transactions were submitted but ` +
                    `never confirmed within ${timeoutMs}ms: ${missing}. They may have been dropped. ` +
                    `Inspect them at ${explorerTxUrl(signatures[pending.values().next().value ?? 0]!, cluster)} ` +
                    `before re-running.`,
            );
        }
        await sleep(pollMs);
    }

    // ---------------------------------------------------------------------------------
    // Phase 3: fetch each transaction for its logs. Paced, because this is N calls.
    // ---------------------------------------------------------------------------------
    const results: SubmitResult[] = [];
    for (let index = 0; index < signatures.length; index += 1) {
        const signature = signatures[index]!;
        let detail: Awaited<ReturnType<ReturnType<DemoRpc['getTransaction']>['send']>> | null = null;
        for (let attempt = 0; attempt < 12 && detail === null; attempt += 1) {
            try {
                detail = await rpc
                    .getTransaction(signature, {
                        encoding: 'json',
                        commitment: 'confirmed',
                        maxSupportedTransactionVersion: 0,
                    })
                    .send();
            } catch (error) {
                if (!isRateLimitError(error)) {
                    throw error;
                }
                await sleep(retryAfterMs(error, attempt));
                continue;
            }
            if (detail === null) {
                await sleep(300);
            }
        }

        const meta = detail?.meta ?? null;
        const err = errors[index] ?? null;
        results.push({
            signature,
            slot: detail?.slot ?? null,
            failed: err !== null,
            transactionError: err,
            logs: meta?.logMessages ?? [],
            computeUnitsConsumed: toBigIntOrNull(meta?.computeUnitsConsumed),
            fee: toBigIntOrNull(meta?.fee),
        });
        if (index < signatures.length - 1) {
            await sleep(150);
        }
    }

    return results;
}

/** `true` when the RPC refused the call because we are over its rate limit. */
function isRateLimitError(error: unknown): boolean {
    if (isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
        return error.context.statusCode === 429;
    }
    const message = error instanceof Error ? error.message : String(error);
    return /429|Too Many Requests|rate limit/i.test(message);
}

/**
 * How long to wait after a 429.
 *
 * The server's own `retry-after` is authoritative when present; otherwise back off
 * exponentially. The public devnet endpoint returns `retry-after: 10`, so the default
 * ceilings are set above that.
 */
function retryAfterMs(error: unknown, attempt: number): number {
    if (isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
        const header = error.context.headers?.get?.('retry-after');
        if (header !== null && header !== undefined) {
            const seconds = Number.parseInt(header, 10);
            if (Number.isFinite(seconds) && seconds > 0) {
                return Math.min(seconds * 1_000 + 500, 30_000);
            }
        }
    }
    return Math.min(1_000 * 2 ** attempt, 20_000) + Math.round(Math.random() * 500);
}

/**
 * Render an arbitrary transaction error as one readable line.
 *
 * Solana reports instruction failures as `{ InstructionError: [index, detail] }`, which
 * stringifies to something no reader can use. The SDK's `classifyError` handles the
 * CommitOnce-specific codes; this is the fallback for everything else.
 */
export function describeTransactionError(error: unknown): string {
    if (error === null || error === undefined) {
        return 'unknown error';
    }
    if (typeof error === 'string') {
        return error;
    }
    const parts = (error as { InstructionError?: unknown }).InstructionError;
    if (Array.isArray(parts) && parts.length >= 2) {
        const index = parts[0];
        const detail: unknown = parts[1];
        const custom = (detail as { Custom?: unknown } | null | undefined)?.Custom;
        const customCode = asNumber(custom);
        if (customCode !== null) {
            return `instruction ${String(index)} failed with custom program error ${customCode}`;
        }
        return `instruction ${String(index)} failed: ${safeStringify(detail)}`;
    }
    return safeStringify(error);
}

/** Coerce whatever the client produced into a number: kit decodes u32 fields as bigint. */
function asNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value)) {
        return value;
    }
    if (typeof value === 'bigint' && value >= -9_007_199_254_740_991n && value <= 9_007_199_254_740_991n) {
        return Number(value);
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value)) {
        return Number(value);
    }
    return null;
}

/** `JSON.stringify` that survives bigint, which the RPC transformers produce routinely. */
function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value, (_key, item: unknown) =>
            typeof item === 'bigint' ? item.toString() : item,
        );
    } catch {
        return String(value);
    }
}

/**
 * The lowest Anchor custom program error code, i.e. the first variant of a program's
 * `#[error_code]` enum. Everything this demo recognises lives in `[6000, 6100)`.
 */
const ANCHOR_CUSTOM_ERROR_FLOOR = 6000;
const ANCHOR_CUSTOM_ERROR_CEILING = 6100;

/**
 * Find a program's custom error code in whatever the cluster returned.
 *
 * This exists because the SDK's `classifyError` cannot see the shape @solana/kit 8.3.0
 * actually produces. The wire value is
 * `{"InstructionError":[1,{"Custom":6000}]}`, but kit's transformers decode numeric fields
 * as **bigint**, so it arrives as `{InstructionError:[1n,{Custom:6000n}]}`. `classifyError`
 * walks the object graph looking for a `number` in the Anchor custom range
 * (`packages/sdk/src/errors.ts`, `findCustomCode`), so a bigint does not match and it
 * reports `{ kind: 'other' }`.
 *
 * So the demo reads the code itself — accepting number, bigint and numeric string, and also
 * the `custom program error: 0x1770` form that the runtime writes into the logs. It then
 * cross-checks against the SDK's own `classifyError`, and reports a disagreement rather than
 * picking a winner silently. See apps/demo/README.md, "Known rough edges".
 */
export function customProgramErrorCode(value: unknown): number | null {
    const seen = new Set<unknown>();
    const stack: unknown[] = [value];

    while (stack.length > 0) {
        const current = stack.pop();
        if (current === null || current === undefined || seen.has(current)) {
            continue;
        }
        seen.add(current);

        const numeric = asNumber(current);
        if (numeric !== null) {
            if (numeric >= ANCHOR_CUSTOM_ERROR_FLOOR && numeric < ANCHOR_CUSTOM_ERROR_CEILING) {
                return numeric;
            }
            continue;
        }

        if (typeof current === 'string') {
            const hex = /custom program error: 0x([0-9a-f]+)/i.exec(current);
            if (hex?.[1] !== undefined) {
                const parsed = Number.parseInt(hex[1], 16);
                if (parsed >= ANCHOR_CUSTOM_ERROR_FLOOR && parsed < ANCHOR_CUSTOM_ERROR_CEILING) {
                    return parsed;
                }
            }
            continue;
        }

        if (typeof current === 'object') {
            // `Object.values` on an Error is empty: `message` and `stack` are non-enumerable.
            if (current instanceof Error) {
                stack.push(current.message);
            }
            for (const item of Object.values(current as Record<string, unknown>)) {
                stack.push(item);
            }
        }
    }
    return null;
}

/** Pick the explorer cluster from the RPC URL, so links match where the run actually went. */
export function explorerClusterForRpc(rpcUrl: string): 'devnet' | 'testnet' | 'mainnet-beta' | 'custom' {
    const lower = rpcUrl.toLowerCase();
    if (lower.includes('devnet')) {
        return 'devnet';
    }
    if (lower.includes('testnet')) {
        return 'testnet';
    }
    if (lower.includes('mainnet')) {
        return 'mainnet-beta';
    }
    return 'custom';
}

/** A working explorer link for a signature on the given cluster. */
export function explorerTxUrl(signature: string, cluster: string): string {
    const suffix = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
    return `https://explorer.solana.com/tx/${signature}${suffix}`;
}
