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
];

/** Constants whose values must be identical in both builds, not merely present. */
const EXPECTED_CONSTANTS = {
    COMMIT_ONCE_PROGRAM_ADDRESS: 'CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB',
    RECEIPT_ACCOUNT_SIZE: 202,
    RECEIPT_RENT_LAMPORTS: 1676400,
    MIN_RETENTION_SECONDS: 3600,
    MAX_RETENTION_SECONDS: 31536000,
    SLOTS_PER_SECOND: 4,
};

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
}

if (failures.length > 0) {
    console.error('\ndual-format check FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
}

console.log('\ndual-format check PASSED: both builds load and agree.');
