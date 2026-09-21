/**
 * # CommitOnce A/B demo
 *
 * One logical intent — "increment my counter by one" — sent twice, as two genuinely rebuilt
 * transactions, against devnet. Twice: once with no guard, once with the guard.
 *
 * The only difference between the two scenarios is one prepended instruction. That is the
 * entire product surface: `commit_once::claim` is added to the *same atomic transaction* as
 * the business instruction, so if the receipt already exists the guard errors and the whole
 * transaction reverts.
 *
 * ## Why the retry is genuinely different bytes
 *
 * Solana deduplicates transactions by **message hash**. Two attempts with byte-identical
 * messages are caught by the runtime's status cache and surface as `AlreadyProcessed` — that
 * protection is real, and it is not what this demo is about.
 *
 * A retry is rebuilt. The client lost the response, so it fetches a fresh blockhash, raises
 * its priority fee because the first attempt was slow, and re-signs. The message bytes now
 * differ, the message hash differs, and the runtime has no way to connect attempt 2 to
 * attempt 1. Both land. That is the bug, and scenario A reproduces it.
 *
 * So each scenario's attempt 2 changes exactly two transport details — blockhash and priority
 * fee — and *nothing* semantic. The intent fingerprint is printed alongside, unchanged,
 * because it deliberately excludes blockhash, priority fee and signature. If the fingerprint
 * included any transport detail, a retry would look like a different intent and the guard
 * would be useless.
 *
 * ## What this proves, and what it does not
 *
 * It proves: at-most-once successful execution of a guarded logical intent within the
 * configured retention window. It does not prove "exactly once" in general — a receipt can be
 * closed after it expires, which frees the key. See docs/ARCHITECTURE.md section 5.
 *
 * ## Run it
 *
 *   PAYER_KEYPAIR=~/.config/solana/id.json node apps/demo/commitonce-demo.ts
 *
 * See apps/demo/README.md. Devnet only. The programs are unaudited.
 */

import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import {
    bytesToHex,
    classifyError,
    COMMIT_ONCE_ERROR_CODES,
    COMMIT_ONCE_ERROR_MESSAGES,
    COMMIT_ONCE_PROGRAM_ADDRESS,
    createCommitOnceClient,
    hashIntent,
    type CanonicalIntent,
    type IntentReceiptAccount,
    type Retention,
} from '@commitonce/solana';

import {
    DEMO_COUNTER_PROGRAM_ADDRESS,
    assertDemoCounterWireFormat,
    createIncrementCounterInstruction,
    createInitializeCounterInstruction,
    deriveCounterAddress,
    fetchCounter,
} from './src/demo-counter.ts';
import { loadPayer, PAYER_KEYPAIR_JSON_VAR, PAYER_KEYPAIR_PATH_VAR } from './src/payer.ts';
import { ConfigError, DemoFailure } from './src/errors.ts';
import {
    abbreviate,
    blank,
    field,
    group,
    heading,
    paragraph,
    rule,
    section,
    sol,
    table,
} from './src/report.ts';
import {
    DEFAULT_RPC_URL,
    buildSignedTransaction,
    createRpc,
    createSetComputeUnitPriceInstruction,
    customProgramErrorCode,
    describeTransactionError,
    explorerClusterForRpc,
    explorerTxUrl,
    fetchFreshBlockhash,
    fetchLamportBalance,
    submitAndConfirm,
    type DemoRpc,
} from './src/solana.ts';

// ---------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------

/**
 * Priority fee for the first attempt of each scenario: the client's normal setting.
 */
const PRIORITY_FEE_FIRST = 1_000n;

/**
 * Priority fee for the rebuilt retry: the client got impatient after a slow confirmation and
 * raised its fee. This changes the transaction's bytes — which is exactly how a real retry
 * escapes message-hash deduplication, and exactly what the guard is designed to survive.
 */
const PRIORITY_FEE_RETRY = 50_000n;

/** How much SOL each fresh authority is given. Comfortably covers rent plus fees. */
const FUNDING_LAMPORTS = 50_000_000n;

/** Default idempotency key, matching the Rust invariant suite. */
const DEFAULT_IDEMPOTENCY_KEY = 'order_928';

/** Default namespace, matching the Rust invariant suite. */
const DEFAULT_NAMESPACE = 'demo:counter';

/**
 * Scenario A and scenario B each need a counter that starts at zero, and a counter PDA is
 * keyed by its owner. So each scenario gets its own freshly generated authority, funded from
 * the payer. Nothing about the *intent* differs between them beyond that.
 */
const SCENARIO_A_COUNTER_EXPECTED = 2n;
const SCENARIO_B_COUNTER_EXPECTED = 1n;

// ---------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------

/** The two halves of the comparison. */
type ScenarioMode = 'without-guard' | 'with-guard';
type AttemptOutcome = {
    readonly number: number;
    readonly blockhash: string;
    readonly previousBlockhash: string | null;
    readonly priorityFee: bigint;
    readonly previousPriorityFee: bigint | null;
    readonly signature: string;
    readonly failed: boolean;
    /** `'success' | 'already-committed' | 'unexpected'` */
    readonly kind: 'success' | 'already-committed' | 'unexpected';
    readonly errorSummary: string | null;
    readonly logs: readonly string[];
    readonly counterAfter: bigint;
    readonly slot: bigint | null;
    readonly computeUnits: bigint | null;
    readonly fee: bigint | null;
};

type ScenarioResult = {
    readonly id: 'A' | 'B';
    readonly mode: ScenarioMode;
    readonly authority: KeyPairSigner;
    readonly counterAddress: Address;
    readonly intentHashHex: string;
    readonly receiptAddress: Address | null;
    readonly receipt: IntentReceiptAccount | null;
    readonly attempts: readonly AttemptOutcome[];
    readonly counterFinal: bigint;
    readonly expected: bigint;
    readonly passed: boolean;
};

type Options = {
    readonly rpcUrl: string;
    readonly namespace: string;
    readonly idempotencyKey: string;
    readonly retention: Retention;
};

type Context = Options & {
    readonly rpc: DemoRpc;
    readonly cluster: string;
    readonly payer: KeyPairSigner;
    readonly payerSource: string;
};

// ---------------------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------------------

const USAGE = [
    'CommitOnce A/B demo — devnet',
    '',
    'Usage:',
    '  node apps/demo/commitonce-demo.ts [options]',
    '',
    'Options:',
    '  --rpc <url>          RPC endpoint. Default $SOLANA_RPC_URL or',
    `                       ${DEFAULT_RPC_URL}`,
    `  --namespace <ns>     CommitOnce namespace. Default ${DEFAULT_NAMESPACE}`,
    `  --key <key>          Idempotency key. Default ${DEFAULT_IDEMPOTENCY_KEY}`,
    "  --retention <r>      Receipt retention, e.g. 24h, 7d, permanent. Default 24h",
    '  -h, --help           Print this and exit',
    '',
    'Environment:',
    `  ${PAYER_KEYPAIR_PATH_VAR.padEnd(20)} Path to a solana CLI keypair file that pays for the run`,
    `  ${PAYER_KEYPAIR_JSON_VAR.padEnd(20)} The same JSON array, inline. Wins if both are set`,
    '',
    'One of the two payer variables is required. The demo mints a fresh authority for each',
    'scenario and funds it from that payer, so repeated runs behave identically.',
].join('\n');

function parseArgs(argv: readonly string[]): Options | null {
    let rpcUrl = process.env['SOLANA_RPC_URL'] ?? DEFAULT_RPC_URL;
    let namespace = DEFAULT_NAMESPACE;
    let idempotencyKey = DEFAULT_IDEMPOTENCY_KEY;
    let retention: Retention = '24h';

    for (let index = 0; index < argv.length; index += 1) {
        const flag = argv[index];
        const value = argv[index + 1];
        const take = (): string => {
            if (value === undefined || value.startsWith('--')) {
                throw new Error(`CommitOnce demo: ${String(flag)} needs a value.\n\n${USAGE}`);
            }
            index += 1;
            return value;
        };
        switch (flag) {
            case '-h':
            case '--help':
                return null;
            case '--rpc':
                rpcUrl = take();
                break;
            case '--namespace':
                namespace = take();
                break;
            case '--key':
                idempotencyKey = take();
                break;
            case '--retention':
                retention = take() as Retention;
                break;
            default:
                throw new Error(`CommitOnce demo: unrecognised argument ${String(flag)}.\n\n${USAGE}`);
        }
    }

    return { rpcUrl, namespace, idempotencyKey, retention };
}

// ---------------------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------------------

function printBanner(context: Context): void {
    heading('CommitOnce A/B demo — the same rebuilt retry, with and without the guard');
    blank();
    paragraph(
        'Solana deduplicates transactions by message hash. A retry that is rebuilt — new ' +
            'blockhash, higher priority fee, re-signed — has different bytes, so the runtime ' +
            'sees a brand new transaction and will execute it a second time. That is the bug.',
    );
    blank();
    paragraph(
        'CommitOnce prepends one instruction, commit_once::claim, to the SAME atomic ' +
            'transaction as the business instruction. It creates a receipt PDA keyed by ' +
            '(authority, namespace, idempotency key). If the receipt already exists, claim ' +
            'errors, the transaction reverts, and the business instruction never runs again. ' +
            'That is the fix.',
    );
    blank();
    paragraph(
        'Guarantee: at-most-once SUCCESSFUL execution of a guarded logical intent within the ' +
            'configured retention window. Not "exactly once" in general — an expired receipt can ' +
            'be closed, which frees the key again.',
    );
    section('Environment');
    field('cluster', context.cluster);
    field('rpc', context.rpcUrl);
    field('commit_once', COMMIT_ONCE_PROGRAM_ADDRESS);
    field('demo_counter', DEMO_COUNTER_PROGRAM_ADDRESS);
    field('payer source', context.payerSource);
    field('payer', context.payer.address);
    field('status', 'DEVNET ONLY — the programs are UNAUDITED');
}

function printAttempt(
    mode: ScenarioMode,
    attempt: AttemptOutcome,
    total: number,
    intentHashHex: string,
    instructionLabels: readonly string[],
    explorer: string,
): void {
    blank();
    const rebuilt = attempt.number > 1;
    const caption = rebuilt
        ? `  attempt ${attempt.number} of ${total}  (REBUILT — what a client sends after an ambiguous timeout)`
        : `  attempt ${attempt.number} of ${total}  (baseline — first send)`;
    console.log(caption);

    if (rebuilt && attempt.previousBlockhash !== null && attempt.previousPriorityFee !== null) {
        field(
            'changed',
            `blockhash      ${abbreviate(attempt.previousBlockhash)} -> ${abbreviate(attempt.blockhash)}   CHANGED`,
            4,
            16,
        );
        field(
            'changed',
            `priority fee   ${group(attempt.previousPriorityFee)} -> ${group(attempt.priorityFee)} micro-lamports/CU   CHANGED`,
            4,
            16,
        );
        field('changed', 'signature      differs, because the message bytes differ   CHANGED', 4, 16);
        field('unchanged', `intent hash    ${intentHashHex}   UNCHANGED`, 4, 16);
        console.log(
            `      ${' '.repeat(16)}the fingerprint covers the semantic intent only. It excludes blockhash,`,
        );
        console.log(`      ${' '.repeat(16)}priority fee and signature on purpose: a retry must look like the`);
        console.log(`      ${' '.repeat(16)}same intent, or the guard cannot do its job.`);
    } else {
        field('changed', 'nothing — this is the first attempt', 4, 16);
        field('unchanged', `intent hash    ${intentHashHex}`, 4, 16);
    }

    field('blockhash', attempt.blockhash, 4, 16);
    field('priority fee', `${group(attempt.priorityFee)} micro-lamports/CU`, 4, 16);
    field('instructions', instructionLabels.join('  '), 4, 16);
    field('signature', attempt.signature, 4, 16);
    field('explorer', explorer, 4, 16);

    if (attempt.failed) {
        field('outcome', `FAILED — ${attempt.errorSummary ?? 'unknown error'}`, 4, 16);
    } else {
        const slot = attempt.slot === null ? 'unknown slot' : `slot ${attempt.slot}`;
        const units = attempt.computeUnits === null ? '' : `, ${group(attempt.computeUnits)} CU`;
        const fee = attempt.fee === null ? '' : `, fee ${group(attempt.fee)} lamports`;
        field('outcome', `SUCCESS — ${slot}${units}${fee}`, 4, 16);
    }

    if (attempt.logs.length > 0) {
        console.log(`      ${'program logs'.padEnd(16)}`);
        for (const line of attempt.logs) {
            console.log(`        | ${line}`);
        }
    }

    field('counter onchain', `${attempt.counterAfter}`, 4, 16);
    if (mode === 'with-guard' && attempt.kind === 'already-committed') {
        console.log(
            `      ${' '.repeat(16)}unchanged — claim reverted the whole transaction, so the guarded`,
        );
        console.log(`      ${' '.repeat(16)}increment never executed.`);
    }
}

// ---------------------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------------------

/**
 * Run one scenario: initialize a counter, then send the same logical intent twice as two
 * rebuilt transactions, and assert on the counter the chain actually holds.
 *
 * The only difference between the two modes is whether `claim` is prepended to the
 * increment. Everything else — the intent, the fingerprint, the rebuild pattern, the
 * priority fee sequence — is identical.
 */
async function runScenario(
    context: Context,
    options: {
        readonly id: 'A' | 'B';
        readonly mode: ScenarioMode;
        readonly authority: KeyPairSigner;
    },
): Promise<ScenarioResult> {
    const { id, mode, authority } = options;
    const { rpc, cluster } = context;

    const counterAddress = await deriveCounterAddress(authority.address);
    const intent = intentFor(counterAddress);
    const intentHashHex = bytesToHex(await hashIntent(intent));

    section(`Scenario ${id} — ${mode}`);
    blank();
    paragraph(
        mode === 'without-guard'
            ? 'No guard. Two rebuilt transactions for the same logical intent. Both are expected to ' +
                  'succeed, and the counter is expected to reach 2.'
            : 'Guarded. Each transaction is [commit_once::claim, demo_counter::increment]. The first is ' +
                  'expected to succeed, the second to fail with AlreadyCommitted, and the counter is ' +
                  'expected to reach 1.',
    );
    field('authority', authority.address);
    field('counter PDA', counterAddress);
    field('logical intent', `increment counter ${counterAddress} by 1`);
    field('intent fingerprint', intentHashHex);

    // The guard is prepared with the SDK. It is a pure, local computation: no RPC, no prover,
    // no indexer round trip. Only the receipt PDA derivation needs the authority, and the
    // authority is already bound into the seeds, so a third party who learns the key derives a
    // different address and cannot consume it.
    const commitOnce = createCommitOnceClient({ rpc });
    const guard =
        mode === 'with-guard'
            ? await commitOnce.prepare({
                  authority: authority.address,
                  namespace: context.namespace,
                  idempotencyKey: context.idempotencyKey,
                  intent,
                  retention: context.retention,
              })
            : null;

    if (guard !== null) {
        field('namespace', context.namespace);
        field('idempotency key', context.idempotencyKey);
        field('retention', `${guard.retentionSeconds.toString()} seconds`);
        field('receipt PDA', guard.receipt);
        field('refund destination', guard.refundDestination);
    } else {
        field('namespace', `${context.namespace}  (unused — nothing is claimed)`);
        field('idempotency key', `${context.idempotencyKey}  (unused — nothing is claimed)`);
    }

    // -----------------------------------------------------------------------------------
    // Setup: create the counter at zero. This is not the guarded action; it is what makes the
    // guarded action observable. It runs in its own unguarded transaction.
    // -----------------------------------------------------------------------------------
    const initializeInstruction = await createInitializeCounterInstruction(authority.address);
    const setupLifetime = await fetchFreshBlockhash(rpc, null);
    const setupSigned = await buildSignedTransaction({
        feePayer: authority,
        instructions: [initializeInstruction],
        lifetime: setupLifetime.lifetime,
    });
    const setupResult = await submitAndConfirm(rpc, setupSigned, { cluster });
    if (setupResult.failed) {
        throw new DemoFailure(
            [
                `CommitOnce demo: scenario ${id} could not initialize the counter, so the scenario cannot`,
                `be run. This is a setup failure, not a result.`,
                `signature: ${setupResult.signature}`,
                `error:     ${describeTransactionError(setupResult.transactionError)}`,
                `logs:`,
                ...setupResult.logs.map((line) => `  ${line}`),
            ].join('\n'),
        );
    }
    blank();
    field('setup', `counter initialized at 0 in ${setupResult.signature}`, 4, 16);
    field('setup explorer', explorerTxUrl(setupResult.signature, cluster), 4, 16);

    // -----------------------------------------------------------------------------------
    // The two attempts.
    // -----------------------------------------------------------------------------------
    const incrementInstruction = await createIncrementCounterInstruction(authority.address);
    const attempts: AttemptOutcome[] = [];

    for (let attemptNumber = 1; attemptNumber <= 2; attemptNumber += 1) {
        const previous = attempts[attempts.length - 1] ?? null;
        const priorityFee = attemptNumber === 1 ? PRIORITY_FEE_FIRST : PRIORITY_FEE_RETRY;

        // Rebuild: a fresh blockhash, distinct from the previous attempt's. The demo refuses to
        // continue if the cluster will not offer one, because "rebuilt" would then be a lie.
        const fresh = await fetchFreshBlockhash(rpc, previous?.blockhash ?? null);

        const instructions = [
            // Transport only. Changes the bytes; carries no semantic content.
            createSetComputeUnitPriceInstruction(priorityFee),
            // The guard, when there is one. Same transaction, same atomicity.
            ...(guard === null ? [] : [guard.instruction]),
            // The business action.
            incrementInstruction,
        ];

        const signed = await buildSignedTransaction({
            feePayer: authority,
            instructions,
            lifetime: fresh.lifetime,
        });
        const result = await submitAndConfirm(rpc, signed, { cluster });

        // Read the counter back from the chain rather than assuming. A demo about state that
        // did not change has to actually look at the state.
        const counterRead = await fetchCounter(rpc, authority.address);
        if (counterRead === null) {
            throw new DemoFailure(
                `CommitOnce demo: scenario ${id} attempt ${attemptNumber} ran, but no counter account ` +
                    `exists at ${counterAddress}. The chain state cannot be verified, so the demo ` +
                    `reports failure instead of guessing.`,
            );
        }

        // Classify the failure two independent ways and require them to agree.
        //
        //  * `customProgramErrorCode` reads the code out of the transaction error, accepting
        //    the bigint that @solana/kit 8.3.0 produces for numeric RPC fields.
        //  * the SDK's own `classifyError` is handed the error *and* the program logs, which
        //    is the shape it can actually parse: it recognises the `custom program error:
        //    0x1770` line the runtime writes into the logs.
        //
        // Neither is taken on trust. If they disagree, the demo says so instead of picking a
        // winner, because a disagreement means the guard's failure is not the failure this
        // scenario claims to demonstrate.
        const code = result.failed
            ? (customProgramErrorCode(result.transactionError) ?? customProgramErrorCode(result.logs))
            : null;
        const sdkClassified = classifyError({ err: result.transactionError, logs: result.logs });
        const sdkCode = sdkClassified.kind === 'commit-once' ? sdkClassified.code : null;
        if (code !== null && sdkCode !== null && code !== sdkCode) {
            throw new DemoFailure(
                [
                    ``,
                    `CommitOnce demo: the two error classifiers disagree — scenario ${id} attempt ${attemptNumber}.`,
                    `  code read from the transaction error: ${code}`,
                    `  code reported by the SDK classifier:  ${sdkCode}`,
                    `  signature: ${result.signature}`,
                    `  logs:`,
                    ...result.logs.map((line) => `    ${line}`),
                ].join('\n'),
            );
        }

        const alreadyCommitted =
            result.failed && code === COMMIT_ONCE_ERROR_CODES.AlreadyCommitted;
        const kind: AttemptOutcome['kind'] = !result.failed
            ? 'success'
            : alreadyCommitted
              ? 'already-committed'
              : 'unexpected';

        const errorSummary = result.failed
            ? alreadyCommitted
                ? `AlreadyCommitted (custom program error ${COMMIT_ONCE_ERROR_CODES.AlreadyCommitted}) - ` +
                  COMMIT_ONCE_ERROR_MESSAGES.AlreadyCommitted
                : `${describeTransactionError(result.transactionError)}${
                      code === null ? '' : ` (custom program error ${code})`
                  }`
            : null;

        const outcome: AttemptOutcome = {
            number: attemptNumber,
            blockhash: fresh.lifetime.blockhash,
            previousBlockhash: previous?.blockhash ?? null,
            priorityFee,
            previousPriorityFee: previous?.priorityFee ?? null,
            signature: result.signature,
            failed: result.failed,
            kind,
            errorSummary,
            logs: result.logs,
            counterAfter: counterRead.state.count,
            slot: result.slot,
            computeUnits: result.computeUnitsConsumed,
            fee: result.fee,
        };
        attempts.push(outcome);

        printAttempt(
            mode,
            outcome,
            2,
            intentHashHex,
            instructionLabels(mode),
            explorerTxUrl(result.signature, cluster),
        );

        // ---------------------------------------------------------------------------------
        // Honest failure. If the attempt did anything other than what this scenario claims,
        // say so, dump the logs, and exit non-zero. Never continue as though it passed.
        // ---------------------------------------------------------------------------------
        const expected = expectedCounterFor(mode, attemptNumber);
        if (kind !== expected) {
            throw new DemoFailure(
                [
                    ``,
                    `CommitOnce demo: UNEXPECTED OUTCOME — scenario ${id} (${mode}) attempt ${attemptNumber}.`,
                    ``,
                    `  expected   ${expected}`,
                    `  observed   ${kind}${errorSummary === null ? '' : ` (${errorSummary})`}`,
                    ``,
                    `  signature  ${result.signature}`,
                    `  explorer   ${explorerTxUrl(result.signature, cluster)}`,
                    ``,
                    `  This is not the behaviour the demo claims to demonstrate, so the run is reported as`,
                    `  a failure rather than explained away. Full program logs:`,
                    ``,
                    ...(result.logs.length > 0 ? result.logs.map((line) => `    ${line}`) : ['    (no logs returned)']),
                ].join('\n'),
            );
        }
    }

    // -----------------------------------------------------------------------------------
    // Verify the outcome onchain, from a fresh read.
    // -----------------------------------------------------------------------------------
    const finalRead = await fetchCounter(rpc, authority.address);
    if (finalRead === null) {
        throw new DemoFailure(`CommitOnce demo: the counter at ${counterAddress} disappeared.`);
    }
    const counterFinal = finalRead.state.count;
    const expectedFinal = mode === 'without-guard' ? SCENARIO_A_COUNTER_EXPECTED : SCENARIO_B_COUNTER_EXPECTED;

    blank();
    field('final read', `counter account ${counterAddress}`, 4, 16);
    field('count', `${counterFinal}`, 4, 16);
    field('last slot', `${finalRead.state.lastSlot}`, 4, 16);

    if (counterFinal !== expectedFinal) {
        throw new DemoFailure(
            [
                ``,
                `CommitOnce demo: ONCHAIN VALUE DOES NOT MATCH EXPECTATION — scenario ${id} (${mode}).`,
                ``,
                `  counter PDA   ${counterAddress}`,
                `  expected      ${expectedFinal}`,
                `  observed      ${counterFinal}`,
                ``,
                `  The demo will not report success on a counter it did not observe. The attempt`,
                `  signatures above are real devnet transactions; inspect them.`,
            ].join('\n'),
        );
    }

    // -----------------------------------------------------------------------------------
    // For the guarded scenario, also read the receipt back, so the reason the retry failed is
    // visible as chain state rather than inferred from an error code.
    // -----------------------------------------------------------------------------------
    let receipt: IntentReceiptAccount | null = null;
    if (guard !== null) {
        receipt = await commitOnce.fetchReceipt(guard.receipt);
        blank();
        if (receipt === null) {
            throw new DemoFailure(
                `CommitOnce demo: scenario ${id} reported a successful guarded commit, but no receipt ` +
                    `exists at ${guard.receipt}. A receipt must exist whenever the guarded action ran.`,
            );
        }
        field('receipt', `${guard.receipt}`, 4, 16);
        field('receipt version', `${receipt.version}`, 4, 16);
        field('receipt payload hash', bytesToHex(receipt.payloadHash), 4, 16);
        field('payload hash matches', `${bytesToHex(receipt.payloadHash) === intentHashHex}`, 4, 16);
        field('created slot', `${receipt.createdSlot}`, 4, 16);
        field('expires at slot', `${receipt.expiresAtSlot}`, 4, 16);
        field('expires at (unix)', `${receipt.expiresAtUnixTimestamp}`, 4, 16);
    }

    return {
        id,
        mode,
        authority,
        counterAddress,
        intentHashHex,
        receiptAddress: guard?.receipt ?? null,
        receipt,
        attempts,
        counterFinal,
        expected: expectedFinal,
        passed: counterFinal === expectedFinal,
    };
}

/** What each attempt of a scenario must do for the demo to be telling the truth. */
function expectedCounterFor(mode: ScenarioMode, attemptNumber: number): AttemptOutcome['kind'] {
    if (mode === 'without-guard') {
        return 'success';
    }
    return attemptNumber === 1 ? 'success' : 'already-committed';
}

function instructionLabels(mode: ScenarioMode): readonly string[] {
    return mode === 'with-guard'
        ? ['compute-budget:setComputeUnitPrice', 'commit_once:claim', 'demo_counter:increment']
        : ['compute-budget:setComputeUnitPrice', 'demo_counter:increment'];
}

/**
 * The logical intent.
 *
 * This is the single most important decision in the whole demo, and it is a *negative* one:
 * the fingerprint covers what the user wanted to happen, and nothing about how it was
 * transported. Blockhash, priority fee, signature, compute budget, retry counter and RPC
 * endpoint are all deliberately absent. Include any of them and attempt 2 hashes differently
 * from attempt 1, so the guard would treat a retry as a brand new intent and let it through —
 * which is precisely the failure it exists to prevent.
 */
function intentFor(counterAddress: Address): CanonicalIntent {
    return { action: 'increment-counter', counter: counterAddress, by: 1n };
}

// ---------------------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------------------

function printSummary(results: readonly ScenarioResult[], context: Context): void {
    heading('Summary — the difference, side by side');

    const rows = results.map((result) => [
        `${result.id}  ${result.mode}`,
        `${result.counterFinal}`,
        `${result.expected}`,
        result.passed ? 'PASS' : 'FAIL',
        `${result.attempts.filter((attempt) => !attempt.failed).length} of 2`,
    ]);
    table(['scenario', 'counter onchain', 'expected', 'result', 'attempts that executed'], rows);

    blank();
    paragraph(
        'Same logical intent. Same rebuild pattern: a new blockhash and a 50x priority fee on ' +
            'attempt 2. The only difference is whether commit_once::claim is prepended to the ' +
            'same atomic transaction.',
    );

    blank();
    const attemptRows: string[][] = [];
    for (const result of results) {
        for (const attempt of result.attempts) {
            attemptRows.push([
                `${result.id}${attempt.number}`,
                attempt.number === 1 ? 'first send' : 'rebuilt (new blockhash + fee)',
                attempt.failed ? `FAILED: ${attempt.kind}` : 'success',
                `counter ${attempt.counterAfter}`,
                attempt.signature,
            ]);
        }
    }
    table(['#', 'attempt', 'outcome', 'onchain', 'signature'], attemptRows);

    blank();
    paragraph(
        'Every signature above is a real transaction submitted to devnet and confirmed by the ' +
            'cluster. The failing ones are onchain too: they were submitted with skipPreflight ' +
            'enabled, so they were included in a block and rejected by the runtime rather than ' +
            'being turned away during simulation.',
    );

    blank();
    section('Explorer links');
    for (const result of results) {
        for (const attempt of result.attempts) {
            field(
                `${result.id}${attempt.number}`,
                `${attempt.failed ? 'FAILED  ' : 'SUCCESS '}${explorerTxUrl(attempt.signature, context.cluster)}`,
                2,
                6,
            );
        }
    }

    blank();
    section('What this does and does not prove');
    paragraph(
        'Proves: at-most-once successful execution of a guarded logical intent within the ' +
            'configured retention window. Scenario B reached 1, not 2, and the second attempt ' +
            'failed with AlreadyCommitted, so the guarded increment never ran.',
    );
    blank();
    paragraph(
        'Does not prove: universal exactly-once execution. Once a receipt expires it can be closed ' +
            'by anyone, and closing it frees the key for a new claim. Choose retention: "permanent" ' +
            'when the key must never be reusable. Retention is per-claim, not per-namespace.',
    );
    blank();
    paragraph(
        'Also worth knowing: the two scenarios use different authorities, so their counters, their ' +
            'receipts and their fingerprints differ. That is the authority-scoped PDA working as ' +
            'designed — a third party who learns your namespace and key derives a different receipt ' +
            'and cannot consume or block your intent. Within each scenario, the two attempts share ' +
            'one fingerprint.',
    );
    blank();
    paragraph(
        'Devnet only. The commit_once and demo_counter programs are UNAUDITED and are not ' +
            'deployed to mainnet-beta. Do not treat this as production-ready.',
    );
    blank();
}

// ---------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------

async function main(): Promise<void> {
    let options: Options | null;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 2;
        return;
    }
    if (options === null) {
        console.log(USAGE);
        return;
    }

    const rpc = createRpc(options.rpcUrl);
    const cluster = explorerClusterForRpc(options.rpcUrl);
    const payer = await loadPayer(process.env);

    const context: Context = {
        ...options,
        rpc,
        cluster,
        payer: payer.signer,
        payerSource: payer.source,
    };

    printBanner(context);

    // Recompute every Anchor discriminator this demo hardcodes, so the wire format it uses to
    // read the counter is proven at runtime instead of trusted.
    section('Preflight');
    const checked = await assertDemoCounterWireFormat();
    field('wire format', `ok — recomputed ${checked.join(', ')} from sha256`, 2, 18);

    const payerBalance = await fetchLamportBalance(rpc, payer.signer.address);
    field('payer balance', sol(payerBalance), 2, 18);
    const needed = FUNDING_LAMPORTS * 2n;
    if (payerBalance < needed) {
        throw new ConfigError(
            `CommitOnce demo: the payer ${payer.signer.address} holds ${sol(payerBalance)}, but this run ` +
                `needs about ${sol(needed)} to fund two fresh authorities. Airdrop devnet SOL ` +
                `(solana airdrop 1 --url devnet) or point ${PAYER_KEYPAIR_PATH_VAR} at a better-funded key.`,
        );
    }

    // -----------------------------------------------------------------------------------
    // Fresh authorities. One per scenario, because a counter PDA is keyed by its owner and
    // both scenarios must start from a counter that reads exactly 0.
    // -----------------------------------------------------------------------------------
    const authorityA = await generateKeyPairSigner();
    const authorityB = await generateKeyPairSigner();

    section('Setup — fresh authorities so every run starts from the same place');
    blank();
    paragraph(
        'Each run generates brand new authorities in memory and funds them from the payer. The ' +
            'counter PDA is [b"counter", owner], so a fresh owner means a counter that does not ' +
            'exist yet — repeated runs therefore behave identically, with no cleanup step.',
    );
    field('scenario A authority', authorityA.address);
    field('scenario B authority', authorityB.address);

    // Both funding transfers ride in one transaction: the payer signs, the recipients do not.
    const fundingLifetime = await fetchFreshBlockhash(rpc, null);
    const fundingInstructions = [authorityA, authorityB].map((authority) =>
        getTransferSolInstruction({
            source: payer.signer,
            destination: authority.address,
            amount: FUNDING_LAMPORTS,
        }),
    );
    const fundingSigned = await buildSignedTransaction({
        feePayer: payer.signer,
        instructions: fundingInstructions,
        lifetime: fundingLifetime.lifetime,
    });
    const fundingResult = await submitAndConfirm(rpc, fundingSigned, { cluster });
    if (fundingResult.failed) {
        throw new DemoFailure(
            [
                `CommitOnce demo: the funding transaction failed, so neither scenario can run.`,
                `signature: ${fundingResult.signature}`,
                `error:     ${describeTransactionError(fundingResult.transactionError)}`,
                `logs:`,
                ...fundingResult.logs.map((line) => `  ${line}`),
            ].join('\n'),
        );
    }
    field('funding tx', `${fundingResult.signature}`, 2, 24);
    field('funding explorer', explorerTxUrl(fundingResult.signature, cluster), 2, 24);
    field('funded each with', sol(FUNDING_LAMPORTS), 2, 24);

    // -----------------------------------------------------------------------------------
    // The A/B comparison.
    // -----------------------------------------------------------------------------------
    const resultA = await runScenario(context, { id: 'A', mode: 'without-guard', authority: authorityA });
    const resultB = await runScenario(context, { id: 'B', mode: 'with-guard', authority: authorityB });

    printSummary([resultA, resultB], context);

    const allPassed = resultA.passed && resultB.passed;
    if (!allPassed) {
        process.exitCode = 1;
        console.error('CommitOnce demo: FAILED — an onchain counter did not match its expectation.');
        return;
    }

    console.log('CommitOnce demo: both scenarios behaved exactly as claimed.');
    rule();
    console.log(
        `  without the guard the counter reached ${resultA.counterFinal}; with the guard it reached ${resultB.counterFinal}.`,
    );
    console.log('  The guard did not make the retry fail for an unrelated reason: the retry failed');
    console.log('  with AlreadyCommitted, and the guarded increment never ran a second time.');
    rule();
}

main().catch((error: unknown) => {
    console.error('');
    if (error instanceof ConfigError) {
        // Configuration problems are the user's setup, not a crash. No stack trace: it would
        // only bury the actionable part.
        console.error('='.repeat(92));
        console.error(error.message);
        console.error('='.repeat(92));
        console.error('');
        process.exitCode = 2;
        return;
    }
    console.error('='.repeat(92));
    if (error instanceof DemoFailure) {
        console.error(error.message);
    } else {
        console.error('CommitOnce demo: the run aborted with an unexpected error.');
        console.error('');
        console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    }
    console.error('='.repeat(92));
    console.error('');
    process.exitCode = 1;
});
