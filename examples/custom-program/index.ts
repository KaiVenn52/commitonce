/**
 * CommitOnce example: guarding an arbitrary custom program instruction.
 *
 * The concrete business action here is the repository's own `demo-counter` program
 * (`programs/demo-counter/src/lib.rs`, program id
 * `EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5`). It is a deliberately trivial counter: a
 * successful `increment` raises `count` by exactly one, which makes "did this run twice?"
 * directly observable.
 *
 * `demo-counter` knows nothing about CommitOnce. It does not import it, check for it, or
 * receive any argument about it. That is the design: the guard is a separate instruction in
 * the same atomic transaction, and any program can be guarded this way without changing it.
 *
 * One atomic transaction contains:
 *
 *   [ commit_once::claim      ]   the guard — FIRST
 *   [ demo_counter::initialize ]  only when the counter does not exist yet
 *   [ demo_counter::increment  ]  the business instruction
 *
 * Swapping in your own program:
 *
 *   1. Keep the guard instruction first, in the same transaction as your instruction(s).
 *   2. Put the *semantic* arguments of your instruction into the intent fingerprint — the
 *      accounts and values that define what the user asked for. Never put observed state,
 *      transport details (blockhash, priority fee, signature, retry count) or the current
 *      value of an account into it: see the comment on `intent` below.
 *   3. Build your instruction however you normally do. If your program has a generated
 *      client (Codama from `target/idl/<program>.json`, or Anchor's IDL client), use it — the
 *      hand-encoded discriminators below exist only because this repository has no generated
 *      JavaScript client for `demo-counter` checked in.
 *
 * Run: see README.md in this directory. This example HAS been executed against devnet, against
 * the deployed CommitOnce and demo-counter programs; the raw output is in
 * `submission/evidence/devnet-custom-program-run.log`.
 */

import { readFile } from 'node:fs/promises';

import {
    AccountRole,
    address,
    appendTransactionMessageInstructions,
    createKeyPairSignerFromBytes,
    createSolanaRpc,
    createSolanaRpcSubscriptions,
    createTransactionMessage,
    fetchEncodedAccount,
    getAddressEncoder,
    getProgramDerivedAddress,
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

const NAMESPACE = 'examples:demo-counter';
const RETENTION = '24h' as const;

const BASE_PRIORITY_FEE_MICRO_LAMPORTS = 1_000n;
const MAX_ATTEMPTS = 3;

/** From `declare_id!` in `programs/demo-counter/src/lib.rs`; identical on every cluster. */
const DEMO_COUNTER_PROGRAM_ADDRESS = address('EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5');

/**
 * Anchor instruction and account discriminators, copied from the generated IDL at
 * `target/idl/demo_counter.json` (regenerate it with `anchor build`).
 *
 * They are asserted against `sha256("<namespace>:<name>")[0..8]` at startup, so a stale
 * hardcoded value is caught immediately instead of producing an opaque
 * `InstructionFallbackNotFound` on chain.
 */
const INCREMENT_DISCRIMINATOR = new Uint8Array([11, 18, 104, 9, 104, 174, 59, 33]);
const INITIALIZE_DISCRIMINATOR = new Uint8Array([175, 175, 109, 31, 13, 152, 155, 237]);
const COUNTER_ACCOUNT_DISCRIMINATOR = new Uint8Array([255, 176, 4, 245, 188, 253, 124, 25]);

/**
 * `Counter` account layout, from the struct in `programs/demo-counter/src/lib.rs`:
 *
 *   offset  size  field
 *   0       8     Anchor discriminator, sha256("account:Counter")[0..8]
 *   8       32    owner
 *   40      8     count        (u64 LE)
 *   48      8     last_slot    (u64 LE)
 *   56      32    last_actor
 *   total   88
 */
const COUNTER_ACCOUNT_SIZE = 88;
const COUNTER_COUNT_OFFSET = 40;

const COUNTER_SEED = new TextEncoder().encode('counter');

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
// demo-counter instruction builders (hand-written; see the header)
// ---------------------------------------------------------------------------------------

async function assertDiscriminator(
    label: string,
    expected: Uint8Array,
    preimage: string,
): Promise<void> {
    const actual = (await sha256(new TextEncoder().encode(preimage))).subarray(0, 8);
    if (bytesToHex(actual) !== bytesToHex(expected)) {
        throw new Error(
            `CommitOnce example: the hardcoded ${label} discriminator ${bytesToHex(expected)} ` +
                `does not match sha256("${preimage}")[0..8] = ${bytesToHex(actual)}. ` +
                'Regenerate it from target/idl/demo_counter.json.',
        );
    }
}

async function counterPda(owner: Address): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
        programAddress: DEMO_COUNTER_PROGRAM_ADDRESS,
        // Matches `seeds = [b"counter", owner.key().as_ref()]` in the program.
        seeds: [COUNTER_SEED, getAddressEncoder().encode(owner)],
    });
    return pda;
}

function incrementInstruction(counter: Address, owner: Address): Instruction {
    return {
        programAddress: DEMO_COUNTER_PROGRAM_ADDRESS,
        accounts: [
            { address: counter, role: AccountRole.WRITABLE },
            { address: owner, role: AccountRole.WRITABLE_SIGNER },
        ],
        data: INCREMENT_DISCRIMINATOR,
    };
}

function initializeInstruction(counter: Address, owner: Address): Instruction {
    return {
        programAddress: DEMO_COUNTER_PROGRAM_ADDRESS,
        accounts: [
            { address: counter, role: AccountRole.WRITABLE },
            { address: owner, role: AccountRole.WRITABLE_SIGNER },
            { address: '11111111111111111111111111111111' as Address, role: AccountRole.READONLY },
        ],
        data: INITIALIZE_DISCRIMINATOR,
    };
}

/** Read `count` from the counter account, or `null` when it does not exist yet. */
async function readCount(
    rpc: ReturnType<typeof createSolanaRpc>,
    counter: Address,
): Promise<bigint | null> {
    const account = await fetchEncodedAccount(rpc, counter);
    if (!account.exists) {
        return null;
    }
    if (account.data.length !== COUNTER_ACCOUNT_SIZE) {
        throw new Error(
            `CommitOnce example: the account at ${counter} is ${account.data.length} bytes, ` +
                `expected ${COUNTER_ACCOUNT_SIZE}. It is not a demo-counter Counter account.`,
        );
    }
    if (bytesToHex(account.data.subarray(0, 8)) !== bytesToHex(COUNTER_ACCOUNT_DISCRIMINATOR)) {
        throw new Error(
            `CommitOnce example: the account at ${counter} does not carry the Counter ` +
                'discriminator. Refusing to interpret it.',
        );
    }
    const view = new DataView(account.data.buffer, account.data.byteOffset, account.data.byteLength);
    return view.getBigUint64(COUNTER_COUNT_OFFSET, true);
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

type GuardedIncrementArgs = {
    readonly rpc: ReturnType<typeof createSolanaRpc>;
    readonly sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>;
    readonly commitOnce: CommitOnceClient;
    readonly authority: KeyPairSigner;
    readonly counter: Address;
    readonly needsInitialize: boolean;
    readonly intent: CanonicalIntent;
    readonly label: string;
};

async function submitGuardedIncrement(args: GuardedIncrementArgs): Promise<SubmissionOutcome> {
    const { rpc, sendAndConfirm, commitOnce, authority, counter, needsInitialize, intent, label } =
        args;
    let priorityFeeMicroLamports = BASE_PRIORITY_FEE_MICRO_LAMPORTS;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const { value: latestBlockhash } = await rpc
            .getLatestBlockhash({ commitment: 'confirmed' })
            .send();

        // Pure: no RPC, no prover, no indexer. The same intent always derives the same
        // instruction and the same receipt PDA, which is what makes a rebuilt retry
        // recognisable as a duplicate rather than as a new action.
        const guard = await commitOnce.prepare({
            authority: authority.address,
            namespace: NAMESPACE,
            idempotencyKey: ORDER_ID,
            intent,
            retention: RETENTION,
        });

        const business: Instruction[] = [];
        if (needsInitialize) {
            // `initialize` uses Anchor's `init` constraint and therefore fails if the account
            // already exists. Because the guard runs first, a duplicate submission never
            // reaches it: the guard aborts the transaction with AlreadyCommitted, which is the
            // error the caller should act on.
            business.push(initializeInstruction(counter, authority.address));
        }
        business.push(incrementInstruction(counter, authority.address));

        const message = pipe(
            createTransactionMessage({ version: 0 }),
            (m) => setTransactionMessageFeePayerSigner(authority, m),
            (m) =>
                appendTransactionMessageInstructions(
                    [setComputeUnitPriceInstruction(priorityFeeMicroLamports), guard.instruction, ...business],
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
                `priorityFee=${priorityFeeMicroLamports}µLamports sig=${signature.slice(0, 8)}… ` +
                `businessInstructions=${business.length}`,
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
                        'duplicate blocked, the counter was not incremented again',
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

            // Ambiguous: we cannot tell whether it landed. Rebuild — same key, same intent,
            // fresh blockhash, higher priority fee — and let the guard answer the question.
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
    // Fail loudly and early if the hardcoded discriminators have drifted from the program.
    await assertDiscriminator('increment', INCREMENT_DISCRIMINATOR, 'global:increment');
    await assertDiscriminator('initialize', INITIALIZE_DISCRIMINATOR, 'global:initialize');
    await assertDiscriminator('Counter account', COUNTER_ACCOUNT_DISCRIMINATOR, 'account:Counter');

    const rpc = createSolanaRpc(RPC_URL);
    const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS_URL);
    const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
    const authority = await loadKeypairSigner(KEYPAIR_PATH);
    const commitOnce = createCommitOnceClient({ rpc });

    const counter = await counterPda(authority.address);
    const countBefore = await readCount(rpc, counter);
    const needsInitialize = countBefore === null;

    /**
     * The intent fingerprint: what the user asked for.
     *
     *   included  — the program being invoked, which counter, which logical order
     *   excluded  — blockhash, priority fee, compute budget, signature, retry counter,
     *               submission route, and the counter's *current* value
     *
     * The current value of an account is deliberately excluded: it is observed state, not
     * intent. If another transaction incremented the counter between two attempts, folding
     * the value into the fingerprint would turn an honest retry into an `IdempotencyConflict`
     * — the guard would report a conflict where there is none.
     *
     * `undefined` is rejected by the SDK's encoder, so the optional memo is `null`.
     */
    const intent: CanonicalIntent = {
        action: 'demo-counter:increment',
        program: DEMO_COUNTER_PROGRAM_ADDRESS,
        counter,
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

    console.log('CommitOnce — guarded custom program instruction (demo-counter)');
    console.log(`  rpc              ${RPC_URL}`);
    console.log(`  authority        ${authority.address}`);
    console.log(`  business program ${DEMO_COUNTER_PROGRAM_ADDRESS}`);
    console.log(`  counter PDA      ${counter}`);
    console.log(`  count before     ${countBefore === null ? 'account does not exist yet' : countBefore}`);
    console.log(`  namespace        ${NAMESPACE}`);
    console.log(`  idempotencyKey   ${ORDER_ID}`);
    console.log(`  receipt PDA      ${guard.receipt}`);
    console.log(`  retention        ${guard.retentionSeconds}s`);
    console.log('');
    console.log('Instruction order in the guarded transaction:');
    console.log('  0. compute budget  SetComputeUnitPrice  (transport only)');
    console.log('  1. commit_once     claim                (the guard)');
    if (needsInitialize) {
        console.log('  2. demo_counter    initialize           (counter absent)');
        console.log('  3. demo_counter    increment            (the business instruction)');
    } else {
        console.log('  2. demo_counter    increment            (the business instruction)');
    }
    console.log('');

    line(null, 'submit', `guarded increment, up to ${MAX_ATTEMPTS} attempts`);
    const first = await submitGuardedIncrement({
        rpc,
        sendAndConfirm,
        commitOnce,
        authority,
        counter,
        needsInitialize,
        intent,
        label: 'phase 1',
    });

    console.log('');
    line(null, 'replay', 'phase 2 — same intent, rebuilt transaction, same idempotency key');
    const replay = await submitGuardedIncrement({
        rpc,
        sendAndConfirm,
        commitOnce,
        authority,
        counter,
        // The counter exists by now, so a rebuilt attempt omits `initialize`. The guard still
        // recognises the intent as a duplicate.
        needsInitialize: false,
        intent,
        label: 'phase 2',
    });

    const countAfter = await readCount(rpc, counter);
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
    console.log(`  count before     ${countBefore === null ? 'null' : countBefore}`);
    console.log(`  count after      ${countAfter}`);
    console.log(
        `  increments       ${countBefore === null ? 'n/a (counter was created)' : String((countAfter ?? 0n) - countBefore)} ` +
            '(one, not two)',
    );
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
