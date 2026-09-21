/**
 * Print the canonical CommitOnce test vectors.
 *
 * This script recomputes every cross-language constant from `@solana/kit` primitives
 * alone — it does not import the SDK — so its output is an independent check on the SDK
 * and on the Rust test suite. The values it prints are pinned in:
 *
 *   * `packages/sdk/test/vectors.test.ts`  (TypeScript side)
 *   * `programs/commit-once/tests/wire_format.rs`  (Rust side, for the hash vectors)
 *
 * Run with:  node scripts/print-vectors.mjs
 */

import { createHash } from 'node:crypto';
import { getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';

const PROGRAM_ADDRESS = 'CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB';
const RECEIPT_SEED = new TextEncoder().encode('commit-once');

/** A stable, well-known address used as the fixed authority in the vectors. */
const FIXED_AUTHORITY = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const sha256 = (...parts) => {
    const hash = createHash('sha256');
    for (const part of parts) {
        hash.update(part);
    }
    return hash.digest();
};

const namespaceHash = (namespace) =>
    sha256(Buffer.from('commitonce/namespace/v1'), Buffer.from(namespace, 'utf8'));

const idempotencyKeyHash = (key) =>
    sha256(Buffer.from('commitonce/key/v1'), Buffer.from(key, 'utf8'));

console.log('=== anchor discriminators ===');
for (const name of [
    'global:claim',
    'global:close_receipt',
    'account:IntentReceipt',
    'event:IntentCommitted',
    'event:IntentReceiptClosed',
]) {
    const digest = sha256(Buffer.from(name, 'utf8'));
    console.log(`${name.padEnd(30)} ${digest.subarray(0, 8).toString('hex')}`);
}

console.log('\n=== domain-separated hashes ===');
for (const namespace of ['demo:counter', 'payments:transfer', 'app_a:swap', 'app_b:mint', 'ns', '']) {
    console.log(`namespaceHash(${JSON.stringify(namespace)})`.padEnd(46), namespaceHash(namespace).toString('hex'));
}
for (const key of ['order_928', 'order_1', 'race_key', 'k1', '']) {
    console.log(`idempotencyKeyHash(${JSON.stringify(key)})`.padEnd(46), idempotencyKeyHash(key).toString('hex'));
}

console.log('\n=== receipt PDAs (fixed authority, cross-language vectors) ===');
const addressEncoder = getAddressEncoder();
for (const [namespace, key] of [
    ['demo:counter', 'order_928'],
    ['payments:transfer', 'order_928'],
    ['app_a:swap', 'order_928'],
]) {
    const [pda, bump] = await getProgramDerivedAddress({
        programAddress: PROGRAM_ADDRESS,
        seeds: [
            RECEIPT_SEED,
            addressEncoder.encode(FIXED_AUTHORITY),
            namespaceHash(namespace),
            idempotencyKeyHash(key),
        ],
    });
    console.log(`${namespace} / ${key}`.padEnd(34), `${pda}  bump=${bump}`);
}

console.log('\n=== receipt rent at mainnet rates ===');
console.log('(202 data bytes + 128 overhead) * 5080 lamports/byte =', (202 + 128) * 5080, 'lamports');
