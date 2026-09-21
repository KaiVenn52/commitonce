/**
 * Live contention test — the same-slot race, against real validators.
 *
 * ## Why this exists
 *
 * The Rust suite proves the invariant in LiteSVM, in-process and single-threaded. That is a
 * real proof of the *program's* logic, but it is not a measurement of what happens when
 * several transactions carrying one idempotency key reach a live cluster at the same time.
 * `submission/WORK_LOG.md` recorded that as an untested gap; this script closes it.
 *
 * ## What it does
 *
 * 1. Mints a fresh authority and funds it, so the intent's key space starts empty.
 * 2. Creates that authority's counter, so the guarded action has something to change.
 * 3. Reads **one** blockhash and builds `--attempts` transactions against it. They therefore
 *    all target the same slot. Each carries a different priority fee, so each has a different
 *    message and a different signature — the runtime's message-hash deduplication cannot
 *    connect them, which is precisely the failure mode CommitOnce exists to cover.
 * 4. Fires them all **without awaiting any of them**, then confirms all of them.
 * 5. Asserts exactly one succeeded, every other failed with `AlreadyCommitted`, and the
 *    counter advanced by exactly one.
 *
 * ## What it does not prove
 *
 * It cannot force the cluster to include all the transactions in one slot — that is the
 * leader's decision. The script therefore **reports the slots it actually got** rather than
 * asserting a single one, and says plainly whether the race was same-slot or spread. If the
 * attempts land in different slots, the run is still meaningful (it is contention on a live
 * cluster) but it is not the same-slot case, and the output says so instead of pretending.
 *
 * Usage:
 *
 * ```bash
 * PAYER_KEYPAIR=~/.config/solana/id.json node apps/demo/concurrent-claim.ts
 * PAYER_KEYPAIR=~/.config/solana/id.json node apps/demo/concurrent-claim.ts --attempts 8
 * ```
 */

import {
    generateKeyPairSigner,
    getSignatureFromTransaction,
    type KeyPairSigner,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import {
    bytesToHex,
    COMMIT_ONCE_ERROR_CODES,
    createCommitOnceClient,
    decodeEventsFromLogs,
    hashIntent,
    type CanonicalIntent,
    type Retention,
} from '@commitonce/solana';

import {
    assertDemoCounterWireFormat,
    createIncrementCounterInstruction,
    createInitializeCounterInstruction,
    deriveCounterAddress,
    fetchCounter,
} from './src/demo-counter.ts';
import { ConfigError, DemoFailure } from './src/errors.ts';
import { loadPayer } from './src/payer.ts';
import { blank, field, heading, paragraph, section, sol, table } from './src/report.ts';
import {
    DEFAULT_RPC_URL,
    buildSignedTransaction,
    createRpc,
    createSetComputeUnitPriceInstruction,
    customProgramErrorCode,
    describeTransactionError,
    explorerClusterForRpc,
    explorerTxUrl,
    fetchBlockhash,
    fetchLamportBalance,
    submitAndConfirm,
    submitManyAndConfirm,
} from './src/solana.ts';

// ---------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------

/**
 * Enough to create the counter, pay for `claim`'s receipt deposit, and cover every fee.
 *
 * Deliberately tight rather than generous: this test is meant to be re-run, and anything left
 * in the throwaway authority at the end is swept back to the payer (see the end of `main`).
 * The real requirement is counter rent (1,096,800) + receipt rent (1,676,400) + fees, so
 * 0.01 SOL is roughly three times what a five-attempt run needs.
 */
const FUNDING_LAMPORTS = 10_000_000n;

/** How many competing transactions to fire. Five is enough to be a race, not a load test. */
const DEFAULT_ATTEMPTS = 5;

/**
 * Priority fee step between attempts.
 *
 * Each attempt must be a *different* transaction, or the runtime would deduplicate them by
 * message hash and this would prove nothing about the guard. Varying the fee is how a real
 * client's retries differ from each other.
 */
const PRIORITY_FEE_BASE = 1_000n;
const PRIORITY_FEE_STEP = 7_000n;

const NAMESPACE = 'demo:counter';
const RETENTION: Retention = '24h';

// ---------------------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------------------

type Options = {
    readonly rpcUrl: string;
    readonly attempts: number;
};

function parseArgs(argv: readonly string[]): Options {
    let rpcUrl = DEFAULT_RPC_URL;
    let attempts = DEFAULT_ATTEMPTS;

    for (let index = 0; index < argv.length; index += 1) {
        const flag = argv[index];
        const value = argv[index + 1];
        switch (flag) {
            case '--rpc':
                if (value === undefined) throw new ConfigError('--rpc needs a URL.');
                rpcUrl = value;
                index += 1;
                break;
            case '--attempts': {
                if (value === undefined) throw new ConfigError('--attempts needs a number.');
                const parsed = Number.parseInt(value, 10);
                if (!Number.isInteger(parsed) || parsed < 2 || parsed > 20) {
                    throw new ConfigError('--attempts must be an integer in 2..20.');
                }
                attempts = parsed;
                index += 1;
                break;
            }
            case '--help':
            case '-h':
                console.log(
                    'usage: node apps/demo/concurrent-claim.ts [--rpc URL] [--attempts N]',
                );
                process.exit(0);
                break;
            default:
                if (flag !== undefined && flag.startsWith('--')) {
                    throw new ConfigError(`unknown flag ${flag}`);
                }
        }
    }

    return { rpcUrl, attempts };
}

// ---------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------

type Attempt = {
    readonly index: number;
    readonly priorityFee: bigint;
    readonly signature: string;
    readonly slot: bigint | null;
    readonly failed: boolean;
    readonly errorCode: number | null;
    readonly errorText: string;
    readonly computeUnits: bigint | null;
};

/** A built-but-unsent competing transaction. */
type Built = {
    readonly index: number;
    readonly priorityFee: bigint;
    readonly signed: Awaited<ReturnType<typeof buildSignedTransaction>>;
};

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const rpc = createRpc(options.rpcUrl);
    const cluster = explorerClusterForRpc(options.rpcUrl);

    await assertDemoCounterWireFormat();

    heading('CommitOnce — same-slot contention on a live cluster');
    blank();
    paragraph(
        `${options.attempts} transactions carrying ONE idempotency key, all built against one ` +
            `blockhash and fired without awaiting each other. Exactly one may commit.`,
    );

    // -----------------------------------------------------------------------------------
    // Payer
    // -----------------------------------------------------------------------------------
    const payer = await loadPayer(process.env);
    const payerBalance = await rpc.getBalance(payer.signer.address).send();
    const needed = FUNDING_LAMPORTS + 5_000_000n;
    if (payerBalance.value < needed) {
        throw new DemoFailure(
            `CommitOnce contention test: the payer ${payer.signer.address} holds ` +
                `${sol(payerBalance.value)} but this run needs about ${sol(needed)}. ` +
                `Fund it with \`solana airdrop 1 --url devnet\`.`,
        );
    }
    section('Payer');
    field('source', payer.source);
    field('address', payer.signer.address);
    field('balance', sol(payerBalance.value));

    // -----------------------------------------------------------------------------------
    // A fresh authority, so the key space starts empty.
    // -----------------------------------------------------------------------------------
    const authority: KeyPairSigner = await generateKeyPairSigner();
    const counterAddress = await deriveCounterAddress(authority.address);
    const intent: CanonicalIntent = { action: 'increment-counter', counter: counterAddress, by: 1n };
    const intentHex = bytesToHex(await hashIntent(intent));

    // A key unique to this run: a fixed key would collide with the earlier demo run's receipt
    // and the "first" attempt would fail instead of committing.
    const idempotencyKey = `contention_${Date.now()}`;

    section('The intent under contention');
    field('authority', authority.address);
    field('counter PDA', counterAddress);
    field('namespace', NAMESPACE);
    field('idempotency key', idempotencyKey);
    field('intent fingerprint', intentHex);

    const commitOnce = createCommitOnceClient({ rpc });
    const guard = await commitOnce.prepare({
        authority: authority.address,
        namespace: NAMESPACE,
        idempotencyKey,
        intent,
        retention: RETENTION,
    });
    field('receipt PDA', guard.receipt);

    // -----------------------------------------------------------------------------------
    // Fund and initialise.
    // -----------------------------------------------------------------------------------
    section('Setup');
    const fundingLifetime = await fetchBlockhash(rpc);
    const funding = await buildSignedTransaction({
        feePayer: payer.signer,
        instructions: [
            getTransferSolInstruction({
                source: payer.signer,
                destination: authority.address,
                amount: FUNDING_LAMPORTS,
            }),
        ],
        lifetime: fundingLifetime,
    });
    const fundingResult = await submitAndConfirm(rpc, funding, { cluster });
    if (fundingResult.failed) {
        throw new DemoFailure(
            `funding failed: ${describeTransactionError(fundingResult.transactionError)}\n` +
                fundingResult.logs.join('\n'),
        );
    }
    field('funded', `${sol(FUNDING_LAMPORTS)} -> ${authority.address}`);

    const initLifetime = await fetchBlockhash(rpc);
    const initSigned = await buildSignedTransaction({
        feePayer: authority,
        instructions: [await createInitializeCounterInstruction(authority.address)],
        lifetime: initLifetime,
    });
    const initResult = await submitAndConfirm(rpc, initSigned, { cluster });
    if (initResult.failed) {
        throw new DemoFailure(
            `counter initialisation failed: ${describeTransactionError(initResult.transactionError)}`,
        );
    }
    const before = await fetchCounter(rpc, authority.address);
    if (before === null) {
        throw new DemoFailure('the counter does not exist after initialisation.');
    }
    field('counter created', `${before.address}  count=${before.state.count}`);

    // -----------------------------------------------------------------------------------
    // Build every attempt against ONE blockhash, so they all target the same slot.
    // -----------------------------------------------------------------------------------
    section('Building the attempts');
    const lifetime = await fetchBlockhash(rpc);
    paragraph(
        `All ${options.attempts} attempts share blockhash ${lifetime.blockhash}, so they all ` +
            `target the same slot. Each carries a different priority fee, so each is a distinct ` +
            `signed transaction rather than a rebroadcast.`,
    );

    const increment = await createIncrementCounterInstruction(authority.address);
    const built: Built[] = [];
    for (let index = 0; index < options.attempts; index += 1) {
        const priorityFee = PRIORITY_FEE_BASE + PRIORITY_FEE_STEP * BigInt(index);
        built.push({
            index,
            priorityFee,
            signed: await buildSignedTransaction({
                feePayer: authority,
                instructions: [
                    createSetComputeUnitPriceInstruction(priorityFee),
                    guard.instruction,
                    increment,
                ],
                lifetime,
            }),
        });
    }

    // Prove the attempts really are distinct transactions before firing them. If they were
    // byte-identical the runtime would deduplicate them and this test would be vacuous.
    const signatures = new Set(built.map((entry) => getSignatureFromTransaction(entry.signed)));
    if (signatures.size !== built.length) {
        throw new DemoFailure(
            `the ${built.length} attempts produced only ${signatures.size} distinct signatures. ` +
                `They would be deduplicated by message hash, so this test could not prove anything.`,
        );
    }
    field('distinct signed transactions', `${signatures.size} of ${built.length}`);

    // -----------------------------------------------------------------------------------
    // Fire them all at once, then confirm.
    // -----------------------------------------------------------------------------------
    section('Firing');
    paragraph(
        'All transactions are submitted concurrently with skipPreflight, so a transaction that ' +
            'is expected to fail still reaches a block and produces inspectable logs. ' +
            'Confirmation is polled with a single batched status call rather than one per ' +
            'transaction, because the public devnet endpoint rate-limits per method.',
    );

    const results = await submitManyAndConfirm(
        rpc,
        built.map((entry) => entry.signed),
        { cluster, timeoutMs: 90_000 },
    );

    const attempts: Attempt[] = results.map((result, index) => {
        const entry = built[index]!;
        const code = customProgramErrorCode(result.transactionError);
        return {
            index: entry.index,
            priorityFee: entry.priorityFee,
            signature: result.signature,
            slot: result.slot,
            failed: result.failed,
            errorCode: code,
            errorText: result.failed
                ? describeTransactionError(result.transactionError)
                : 'succeeded',
            computeUnits: result.computeUnitsConsumed,
        };
    });

    // -----------------------------------------------------------------------------------
    // Report.
    // -----------------------------------------------------------------------------------
    section('Result');
    table(
        ['#', 'priority fee', 'slot', 'outcome', 'error'],
        attempts.map((attempt) => [
            `${attempt.index}`,
            `${attempt.priorityFee}`,
            attempt.slot === null ? '?' : `${attempt.slot}`,
            attempt.failed ? 'FAILED' : 'SUCCESS',
            attempt.errorCode === null ? attempt.errorText : `${attempt.errorText} (${attempt.errorCode})`,
        ]),
    );

    blank();
    const slots = new Set(attempts.map((attempt) => (attempt.slot === null ? 'null' : `${attempt.slot}`)));
    const succeeded = attempts.filter((attempt) => !attempt.failed);
    const blocked = attempts.filter(
        (attempt) => attempt.failed && attempt.errorCode === COMMIT_ONCE_ERROR_CODES.AlreadyCommitted,
    );

    field('attempts', `${attempts.length}`);
    field('succeeded', `${succeeded.length}`);
    field('blocked with AlreadyCommitted', `${blocked.length}`);
    field('distinct slots landed in', `${slots.size}  (${[...slots].join(', ')})`);
    field(
        'same-slot race?',
        slots.size === 1
            ? 'yes — every attempt was included in one slot'
            : `no — spread across ${slots.size} slots (the leader chose; the script cannot force this)`,
    );

    const after = await fetchCounter(rpc, authority.address);
    const delta = (after?.state.count ?? 0n) - before.state.count;
    field('counter before', `${before.state.count}`);
    field('counter after', `${after?.state.count ?? '?'}`);
    field('business action executions', `${delta}`);

    // The receipt, and the event the program emitted.
    const receipt = await commitOnce.fetchReceipt(guard.receipt);
    field('receipt exists', receipt === null ? 'no' : 'yes');
    const winner = succeeded[0];
    if (winner !== undefined) {
        const detail = results[winner.index];
        const events = decodeEventsFromLogs(detail?.logs ?? []);
        const committed = events.find((event) => event.name === 'IntentCommitted');
        if (committed?.name === 'IntentCommitted') {
            field('event created_slot', `${committed.data.createdSlot}`);
            field('event payload hash', bytesToHex(committed.data.payloadHash));
        }
        blank();
        field('winning transaction', explorerTxUrl(winner.signature, cluster));
    }

    // -----------------------------------------------------------------------------------
    // Verdict.
    // -----------------------------------------------------------------------------------
    section('Verdict');
    const failures: string[] = [];
    if (succeeded.length !== 1) {
        failures.push(`expected exactly 1 success, got ${succeeded.length}`);
    }
    if (blocked.length !== attempts.length - 1) {
        failures.push(
            `expected ${attempts.length - 1} attempts blocked with AlreadyCommitted ` +
                `(${COMMIT_ONCE_ERROR_CODES.AlreadyCommitted}), got ${blocked.length}`,
        );
    }
    if (delta !== 1n) {
        failures.push(`the business action ran ${delta} times, expected exactly 1`);
    }

    if (failures.length > 0) {
        for (const failure of failures) {
            paragraph(`VIOLATION: ${failure}`);
        }
        process.exit(1);
    }

    paragraph(
        `INVARIANT HOLDS. ${attempts.length} transactions carried one idempotency key; exactly ` +
            `one committed, ${blocked.length} were rejected with AlreadyCommitted, and the ` +
            `business instruction ran once.`,
    );
    if (slots.size === 1) {
        paragraph(
            `All ${attempts.length} were included in slot ${[...slots][0]}, so this was genuinely ` +
                `same-slot contention on a live cluster.`,
        );
    } else {
        paragraph(
            `The attempts landed across ${slots.size} slots rather than one, so this run shows ` +
                `contention on a live cluster but NOT the same-slot case. Re-run for a tighter ` +
                `race, or read the LiteSVM test for the same-slot proof.`,
        );
    }

    // -----------------------------------------------------------------------------------
    // Sweep the unspent balance back to the payer. The authority is thrown away at exit, so
    // anything left in it would simply be destroyed; without this, every re-run of a test
    // that is meant to be re-run would burn the whole funding amount.
    //
    // The receipt's rent is NOT recovered: it is locked for the retention window by design,
    // and `close_receipt` refuses before then. That is the feature working, not a leak.
    // -----------------------------------------------------------------------------------
    section('Cleanup');
    const remaining = await fetchLamportBalance(rpc, authority.address);
    if (remaining > 10_000n) {
        const sweepAmount = remaining - 5_000n;
        try {
            const sweepSigned = await buildSignedTransaction({
                feePayer: authority,
                instructions: [
                    getTransferSolInstruction({
                        source: authority,
                        destination: payer.signer.address,
                        amount: sweepAmount,
                    }),
                ],
                lifetime: await fetchBlockhash(rpc),
            });
            const sweepResult = await submitAndConfirm(rpc, sweepSigned, { cluster });
            field(
                'unspent returned to payer',
                sweepResult.failed
                    ? `failed (${describeTransactionError(sweepResult.transactionError)})`
                    : sol(sweepAmount),
            );
        } catch (error) {
            // A failed sweep must not turn a passing invariant into a failing run. The money is
            // devnet SOL; the invariant is the result.
            field('unspent returned to payer', `skipped (${error instanceof Error ? error.message : String(error)})`);
        }
    } else {
        field('unspent returned to payer', 'nothing left to sweep');
    }
    field('receipt rent still locked', `${sol(1_676_400n)}  (refundable after the retention window)`);
    blank();
}

main().catch((error: unknown) => {
    if (error instanceof ConfigError || error instanceof DemoFailure) {
        console.error(`\n${error.message}\n`);
        process.exit(2);
    }
    console.error(error);
    process.exit(1);
});
