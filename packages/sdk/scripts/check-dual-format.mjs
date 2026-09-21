/**
 * Verify that the built package actually loads under BOTH module systems.
 *
 * This exists because "the build emitted dist/esm and dist/cjs" is not the same claim as
 * "the package resolves in both module systems", and only the second one matters to a
 * consumer. A `exports` map can be wrong in ways that produce a green build and a broken
 * import: a missing `types` condition, a CJS file emitted as ESM syntax, a `require` path
 * that points at a file Node refuses to parse as CommonJS. The only way to catch those is
 * to import the package the way a consumer would.
 *
 * Runs from a `.mjs` file so the ESM half is a genuine `import`, and uses `createRequire`
 * so the CJS half is a genuine `require` rather than an ESM import of a CJS file.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Exports every consumer of this package is entitled to rely on. */
const EXPECTED = [
    'createCommitOnceClient',
    'prepareIntent',
    'encodeClaimData',
    'deriveReceiptAddress',
    'decodeIntentReceipt',
    'classifyError',
    'encodeIntent',
    'hashIntent',
    'namespaceHash',
    'idempotencyKeyHash',
    'COMMIT_ONCE_PROGRAM_ADDRESS',
    // Event decoding. Added after the fact, which is exactly when a dual-package hazard is
    // most likely to slip in: a new module is easy to add to one build's entry point and not
    // the other.
    'decodeCommitOnceEvent',
    'decodeEventsFromLogs',
    'decodeIntentReceiptClosedBody',
    'base64ToBytes',
];

/** Constants whose values must be identical in both builds, not merely present. */
const EXPECTED_CONSTANTS = {
    COMMIT_ONCE_PROGRAM_ADDRESS: 'CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB',
    RECEIPT_ACCOUNT_SIZE: 202,
    RECEIPT_RENT_LAMPORTS: 1676400,
    MIN_RETENTION_SECONDS: 3600,
    MAX_RETENTION_SECONDS: 31536000,
    SLOTS_PER_SECOND: 4,
    INTENT_COMMITTED_EVENT_SIZE: 192,
    INTENT_RECEIPT_CLOSED_EVENT_SIZE: 136,
    PROGRAM_DATA_LOG_PREFIX: 'Program data: ',
};

/**
 * A real `IntentCommitted` emitted on devnet. Decoding it in both builds proves the new
 * module is not only exported but *functional* under both module systems — a different
 * failure mode from a missing export.
 */
const REAL_EVENT_BASE64 =
    'BPlJM9huxPnHK0lahvh8+reWHi+31Lu09ZICpFoMp04pExlS67fJZ3srpKhHIit4sWVd8jkuiaYVQ03Rz/cFVOWai4DTJY3fHai1jVaz8EwZM/d7E0y24SGbdsDvrSZaOZE1seYQBd6wuN2Oj6U/IZtZDup5TmfQAAccvSaEQ4SFBaX8h1WEkscrSVqG+Hz6t5YeL7fUu7T1kgKkWgynTikTGVLrt8lnYJLpHQAAAABg2O4dAAAAAML+sGoAAAAAQlCyagAAAAA=';

const failures = [];

function check(label, mod) {
    for (const name of EXPECTED) {
        if (mod[name] === undefined) {
            failures.push(`${label}: missing export '${name}'`);
        }
    }
    for (const [name, expected] of Object.entries(EXPECTED_CONSTANTS)) {
        const actual = mod[name];
        // Compared as strings on purpose. Several of these are `bigint` in the build (they are
        // lamport and second counts, where the exact integer matters) while the expected values
        // here are plain numbers, so a strict `!==` would report a mismatch for equal values.
        // String comparison is type-agnostic and exact for every scalar in this list.
        if (String(actual) !== String(expected)) {
            failures.push(`${label}: ${name} is ${String(actual)}, expected ${String(expected)}`);
        }
    }
}

// ESM: a real static-style dynamic import through the package's `import` condition.
let esm;
try {
    esm = await import('@commitonce/solana');
    check('ESM', esm);
    console.log(`ESM  ok  (${EXPECTED.length} exports, ${Object.keys(EXPECTED_CONSTANTS).length} constants)`);
} catch (error) {
    failures.push(`ESM: import failed — ${error.message}`);
    console.log(`ESM  FAIL  ${error.message}`);
}

// CJS: a real require through the package's `require` condition.
let cjs;
try {
    cjs = require('@commitonce/solana');
    check('CJS', cjs);
    console.log(`CJS  ok  (${EXPECTED.length} exports, ${Object.keys(EXPECTED_CONSTANTS).length} constants)`);
} catch (error) {
    failures.push(`CJS: require failed — ${error.message}`);
    console.log(`CJS  FAIL  ${error.message}`);
}

// The two builds must be the same code, not merely both loadable.
if (esm && cjs) {
    const esmAddress = esm.COMMIT_ONCE_PROGRAM_ADDRESS;
    const cjsAddress = cjs.COMMIT_ONCE_PROGRAM_ADDRESS;
    if (esmAddress !== cjsAddress) {
        failures.push(`ESM and CJS disagree on the program address: ${esmAddress} vs ${cjsAddress}`);
    }
    // A function exported from one build but not the other is the classic dual-package bug.
    const esmOnly = EXPECTED.filter((n) => esm[n] !== undefined && cjs[n] === undefined);
    const cjsOnly = EXPECTED.filter((n) => cjs[n] !== undefined && esm[n] === undefined);
    if (esmOnly.length > 0) failures.push(`exports present only in ESM: ${esmOnly.join(', ')}`);
    if (cjsOnly.length > 0) failures.push(`exports present only in CJS: ${cjsOnly.join(', ')}`);

    // Both builds must decode the same real event to the same values. Comparing the
    // serialised result rather than field by field keeps this honest about bigints, which
    // JSON.stringify refuses to serialise — hence the explicit replacer.
    const asJson = (event) =>
        JSON.stringify(event, (_key, value) =>
            typeof value === 'bigint' ? `${value}n` : value,
        );
    try {
        const fromEsm = asJson(esm.decodeCommitOnceEvent(esm.base64ToBytes(REAL_EVENT_BASE64)));
        const fromCjs = asJson(cjs.decodeCommitOnceEvent(cjs.base64ToBytes(REAL_EVENT_BASE64)));
        if (fromEsm !== fromCjs) {
            failures.push(`ESM and CJS decode the real devnet event differently:\n    ESM: ${fromEsm}\n    CJS: ${fromCjs}`);
        } else if (!fromEsm.includes('501846624n')) {
            failures.push(`the real devnet event did not decode to its recorded slot: ${fromEsm}`);
        } else {
            console.log('both builds decode the real devnet IntentCommitted identically');
        }
    } catch (error) {
        failures.push(`decoding the real devnet event threw: ${error.message}`);
    }
}

if (failures.length > 0) {
    console.error('\ndual-format check FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
}

console.log('\ndual-format check PASSED: both builds load and agree.');
