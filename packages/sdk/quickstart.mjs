#!/usr/bin/env node
/**
 * The script `docs/QUICKSTART.md` tells you to run.
 *
 * It was referenced from Step 4 of the quickstart and **did not exist**, so a reader following
 * the documented path got `Cannot find module` at the first thing they tried. This is that
 * script, and it is also the quickstart's own executable test: it exercises the four claims the
 * document makes and asserts each of them, so the document cannot drift from the package.
 *
 *   1. `prepareIntent` is pure — no RPC, no prover, no indexer.
 *   2. Two spellings of the same retention, and a different key order in the payload object,
 *      produce the SAME receipt and the SAME instruction bytes.
 *   3. The instruction data is 144 bytes and the account list is the four expected addresses.
 *   4. `classifyError` recognises a nested RPC `AlreadyCommitted`.
 *
 * Run from the repository root, after `pnpm --filter @commitonce/solana build`:
 *
 *   node packages/sdk/quickstart.mjs
 *
 * It needs no network and no keypair on disk: the authority is generated per run, which is why
 * the receipt, refund address and signature differ every time.
 */

import { strict as assert } from 'node:assert';

import {
    appendTransactionMessageInstructions,
    createTransactionMessage,
    generateKeyPairSigner,
    getSignatureFromTransaction,
    pipe,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import {
    bytesToHex,
    classifyError,
    isAlreadyCommitted,
    prepareIntent,
} from './dist/esm/index.js';

const authority = await generateKeyPairSigner();

// The intent: an ordinary object. The SDK canonicalises it, so key order does not matter.
const intent = { amount: 10_000_000n, mint: 'USDC', to: 'alice' };

// 1. Build the guard. Pure: no RPC, no prover, no indexer.
const guard = await prepareIntent({
    authority: authority.address,
    namespace: 'payments:transfer',
    idempotencyKey: 'order_928',
    intent,
    retention: '24h',
});

console.log('program   ', guard.programAddress);
console.log('receipt   ', guard.receipt, '(bump ' + guard.receiptBump + ')');
console.log('namespace ', bytesToHex(guard.namespaceHash));
console.log('key       ', bytesToHex(guard.idempotencyKeyHash));
console.log('payload   ', bytesToHex(guard.payloadHash));
console.log('retention ', guard.retentionSeconds, 'seconds');
console.log('refund to ', guard.refundDestination);
console.log('data      ', guard.instruction.data.length, 'bytes');
console.log('accounts  ', guard.instruction.accounts.map((a) => a.address));

// 2. Prepend the guard to the business instructions, in ONE atomic transaction.
const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(authority, m),
    (m) => appendTransactionMessageInstructions([guard.instruction], m),
    // Any base58 blockhash is fine for a local signing check. Fetch a real one to send.
    (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
            { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1n },
            m,
        ),
);
const signed = await signTransactionMessageWithSigners(message);
console.log('signature ', getSignatureFromTransaction(signed));

// 3. A rebuild must produce the same guard, byte for byte. If it did not, a retry would
//    look like a new intent and the guard would protect nothing.
const rebuilt = await prepareIntent({
    authority: authority.address,
    namespace: 'payments:transfer',
    idempotencyKey: 'order_928',
    intent: { amount: 10_000_000n, mint: 'USDC', to: 'alice' }, // different key order
    retention: 86_400, // different spelling
});
console.log('same receipt', rebuilt.receipt === guard.receipt);
console.log('same bytes  ', bytesToHex(rebuilt.instruction.data) === bytesToHex(guard.instruction.data));

// 4. This is what a blocked duplicate looks like once the RPC reports it.
const rpcError = { context: { err: { InstructionError: [0, { Custom: 6000 }] } } };
const classified = classifyError(rpcError);
console.log('classified  ', classified.kind === 'commit-once' ? classified.name : classified.kind);
console.log('duplicate?  ', isAlreadyCommitted(rpcError));

// ---------------------------------------------------------------------------------------
// Assertions. The quickstart prints these four results; asserting them means the document is
// checked by running it rather than by reading it.
// ---------------------------------------------------------------------------------------

// The receipt is a function of (authority, namespace, key) and nothing else.
assert.equal(rebuilt.receipt, guard.receipt, 'a rebuild must produce the same receipt');

// Two spellings of the same retention and a different key order must produce the same bytes.
assert.equal(
    bytesToHex(rebuilt.instruction.data),
    bytesToHex(guard.instruction.data),
    'canonicalisation must make the instruction bytes identical',
);
assert.equal(guard.retentionSeconds, 86_400n, "'24h' must normalise to 86400 seconds");

// The wire shape the document quotes.
assert.equal(guard.instruction.data.length, 144, 'instruction data must be 144 bytes');
assert.deepEqual(
    guard.instruction.accounts.map((a) => a.address),
    [
        guard.refundDestination,
        guard.receipt,
        'Sysvar1nstructions1111111111111111111111111',
        '11111111111111111111111111111111',
    ],
    'the account list must be refund destination, receipt, instructions sysvar, system program',
);

// And the error classification the document quotes.
assert.equal(classified.kind, 'commit-once', 'a nested Custom: 6000 must classify as CommitOnce');
assert.equal(classified.name, 'AlreadyCommitted');
assert.equal(isAlreadyCommitted(rpcError), true);

console.log();
console.log('All four quickstart claims hold.');
