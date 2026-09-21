/**
 * Cross-language contract tests.
 *
 * Every constant pinned here is asserted *independently* on the Rust side too:
 *
 * * `programs/commit-once/tests/wire_format.rs` pins the domain-separated hashes and the
 *   receipt account layout.
 * * `packages/sdk/scripts/print-vectors.mjs` recomputes the same values from
 *   `@solana/kit` primitives without importing the SDK, so a bug in the SDK cannot make
 *   these tests agree with it by construction.
 *
 * If any of these fail, the onchain program and the SDK have drifted apart.
 */

import { createHash } from 'node:crypto';
import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import { describe, expect, it } from 'vitest';

import {
    CLAIM_DATA_LENGTH,
    CLAIM_DISCRIMINATOR,
    CLOSE_RECEIPT_DISCRIMINATOR,
    COMMIT_ONCE_ERROR_CODES,
    COMMIT_ONCE_PROGRAM_ADDRESS,
    INTENT_RECEIPT_DISCRIMINATOR,
    MAX_RETENTION_SECONDS,
    MIN_RETENTION_SECONDS,
    RECEIPT_ACCOUNT_SIZE,
    RECEIPT_RENT_LAMPORTS,
    RECEIPT_SEED,
    RECEIPT_VERSION,
    ReceiptDecodeError,
    assertValidRetention,
    bytesToHex,
    classifyError,
    decodeIntentReceipt,
    deriveReceiptAddress,
    encodeClaimData,
    encodeIntent,
    hashIntent,
    hexToBytes,
    idempotencyKeyHash,
    isAlreadyCommitted,
    isClosable,
    isIdempotencyConflict,
    isIntentReceipt,
    isPermanentReceipt,
    namespaceHash,
    parseRetention,
    prepareIntent,
    sha256,
    toPayloadHash,
    type Retention,
} from '../src/index.js';

const sha256Of = (...parts: Uint8Array[]) => {
    const hash = createHash('sha256');
    for (const part of parts) hash.update(part);
    return hash.digest();
};

const utf8 = (value: string) => new TextEncoder().encode(value);

/** A stable, well-known address used as the fixed authority in the cross-language vectors. */
const FIXED_AUTHORITY = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

describe('program identity', () => {
    it('is the address declared onchain', () => {
        expect(COMMIT_ONCE_PROGRAM_ADDRESS).toBe('CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB');
    });

    it('uses the same PDA seed prefix as the program', () => {
        expect(new TextDecoder().decode(RECEIPT_SEED)).toBe('commit-once');
        expect(RECEIPT_SEED.length).toBe(11);
    });
});

describe('anchor discriminators', () => {
    it('matches sha256("global:claim")[0..8]', () => {
        expect(bytesToHex(CLAIM_DISCRIMINATOR)).toBe(
            sha256Of(utf8('global:claim')).subarray(0, 8).toString('hex'),
        );
        expect(bytesToHex(CLAIM_DISCRIMINATOR)).toBe('3ec6d6c1d59f6cd2');
    });

    it('matches sha256("global:close_receipt")[0..8]', () => {
        expect(bytesToHex(CLOSE_RECEIPT_DISCRIMINATOR)).toBe('7efef4cb7ca48659');
    });

    it('matches sha256("account:IntentReceipt")[0..8]', () => {
        expect(bytesToHex(INTENT_RECEIPT_DISCRIMINATOR)).toBe('54fc5d647e500f86');
    });
});

describe('domain-separated hashing', () => {
    // These exact strings are asserted by the Rust suite as well.
    const NAMESPACE_VECTORS: [string, string][] = [
        ['demo:counter', '7b2ba4a847222b78b1655df2392e89a615434dd1cff70554e59a8b80d3258ddf'],
        ['payments:transfer', '9e7bb3a4dce399c675e567cec2312197966a9dd8ab00b93834b82ead8a49cde3'],
    ];
    const KEY_VECTORS: [string, string][] = [
        ['order_928', '0a9ba9a57e3b998c5807159e02e362f2d14c85cfe02e5b508e7f2cfd2d3d4e0d'],
        ['order_1', '388806aee4466141bbdfd00b3d65f34cf840ec6b5edd4bdd9687ce73b1aee278'],
    ];

    it.each(NAMESPACE_VECTORS)('namespaceHash(%s)', async (input, expected) => {
        expect(bytesToHex(await namespaceHash(input))).toBe(expected);
        // Independently: sha256(domain || utf8(input)).
        expect(bytesToHex(await namespaceHash(input))).toBe(
            sha256Of(utf8('commitonce/namespace/v1'), utf8(input)).toString('hex'),
        );
    });

    it.each(KEY_VECTORS)('idempotencyKeyHash(%s)', async (input, expected) => {
        expect(bytesToHex(await idempotencyKeyHash(input))).toBe(expected);
        expect(bytesToHex(await idempotencyKeyHash(input))).toBe(
            sha256Of(utf8('commitonce/key/v1'), utf8(input)).toString('hex'),
        );
    });

    it('keeps the namespace and key domains separate', async () => {
        for (const value of ['demo:counter', 'order_928', '']) {
            expect(bytesToHex(await namespaceHash(value))).not.toBe(
                bytesToHex(await idempotencyKeyHash(value)),
            );
        }
    });

    it('distinguishes inputs that are prefixes of one another', async () => {
        expect(bytesToHex(await namespaceHash('abc'))).not.toBe(
            bytesToHex(await namespaceHash('ab:c')),
        );
        expect(bytesToHex(await namespaceHash('a'))).not.toBe(
            bytesToHex(await namespaceHash('')),
        );
    });
});

describe('receipt PDA derivation', () => {
    // Derived independently by packages/sdk/scripts/print-vectors.mjs.
    const PDA_VECTORS: [string, string, string, number][] = [
        ['demo:counter', 'order_928', '7vMcWBtiMjeFgpx96E5ZtVZoYeRLn5Fu57RcTtzJeh9J', 254],
        ['payments:transfer', 'order_928', '654vyv9LHwgAgn2rceouNQj8GXwiatAseFZAKCPPSTYV', 255],
        ['app_a:swap', 'order_928', '4MiJeybibL5QoA6m8Q8ddUuzWnoumZxLPj32G3DHTbFG', 255],
    ];

    it.each(PDA_VECTORS)('%s / %s', async (namespace, key, expectedAddress, expectedBump) => {
        const [receipt, bump] = await deriveReceiptAddress({
            authority: FIXED_AUTHORITY,
            namespaceHash: await namespaceHash(namespace),
            idempotencyKeyHash: await idempotencyKeyHash(key),
        });
        expect(receipt).toBe(expectedAddress);
        expect(bump).toBe(expectedBump);
    });

    it('matches a from-scratch kit derivation', async () => {
        const [expected] = await getProgramDerivedAddress({
            programAddress: COMMIT_ONCE_PROGRAM_ADDRESS,
            seeds: [
                RECEIPT_SEED,
                getAddressEncoder().encode(FIXED_AUTHORITY),
                await namespaceHash('demo:counter'),
                await idempotencyKeyHash('order_928'),
            ],
        });
        const [actual] = await deriveReceiptAddress({
            authority: FIXED_AUTHORITY,
            namespaceHash: await namespaceHash('demo:counter'),
            idempotencyKeyHash: await idempotencyKeyHash('order_928'),
        });
        expect(actual).toBe(expected);
    });

    it('scopes the key space by authority', async () => {
        const nsHash = await namespaceHash('shared:namespace');
        const keyHash = await idempotencyKeyHash('order_928');
        const [mine] = await deriveReceiptAddress({
            authority: FIXED_AUTHORITY,
            namespaceHash: nsHash,
            idempotencyKeyHash: keyHash,
        });
        const [theirs] = await deriveReceiptAddress({
            authority: address('So11111111111111111111111111111111111111112'),
            namespaceHash: nsHash,
            idempotencyKeyHash: keyHash,
        });
        // The same textual key under a different authority must not collide, otherwise a
        // third party could consume someone else's key.
        expect(mine).not.toBe(theirs);
    });

    it('rejects malformed hashes rather than deriving a wrong address', async () => {
        await expect(
            deriveReceiptAddress({
                authority: FIXED_AUTHORITY,
                namespaceHash: new Uint8Array(31),
                idempotencyKeyHash: await idempotencyKeyHash('k'),
            }),
        ).rejects.toThrow(/32-byte Uint8Array/);
    });
});

describe('canonical intent encoding', () => {
    it('produces the documented byte string', () => {
        // Object keys are sorted, and every token is length-prefixed.
        const encoded = encodeIntent({ to: 'alice', memo: 'order', amount: 100n });
        expect(new TextDecoder().decode(encoded)).toBe(
            'o3:s6:amounti3:100s4:memos5:orders2:tos5:alice',
        );
    });

    it('is independent of object key insertion order', () => {
        expect(bytesToHex(encodeIntent({ a: 1, b: 2 }))).toBe(
            bytesToHex(encodeIntent({ b: 2, a: 1 })),
        );
    });

    it('is injective across the cases that matter', () => {
        const distinct: unknown[] = [
            { a: 1 },
            { a: '1' },
            { a: 1n },
            { a: [1] },
            [1, 2],
            [12],
            'x',
            { 0: 'x' },
            { a: 1, b: 2 },
            { ab: 2 },
            null,
            false,
            true,
            '',
        ];
        const seen = new Map<string, unknown>();
        for (const value of distinct) {
            const hex = bytesToHex(encodeIntent(value as never));
            expect(seen.has(hex), `${JSON.stringify(value, replacer)} collides with ${JSON.stringify(seen.get(hex), replacer)}`).toBe(false);
            seen.set(hex, value);
        }
    });

    it('refuses values it cannot encode deterministically', () => {
        // Dropping `undefined` the way JSON.stringify does could make two genuinely
        // different intents encode identically, which would hide a conflict.
        expect(() => encodeIntent({ a: undefined } as never)).toThrow(/undefined/);
        expect(() => encodeIntent(Number.NaN)).toThrow(/non-finite/);
        expect(() => encodeIntent(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
        expect(() => encodeIntent(new Date() as never)).toThrow(/Date/);
        expect(() => encodeIntent(new Map() as never)).toThrow(/Map/);
    });

    it('hashes to 32 bytes and is stable across calls', async () => {
        const first = await hashIntent({ to: 'alice', amount: 10n });
        const second = await hashIntent({ to: 'alice', amount: 10n });
        expect(first.length).toBe(32);
        expect(bytesToHex(first)).toBe(bytesToHex(second));
    });

    it('accepts a precomputed 32-byte fingerprint and rejects other lengths', async () => {
        const precomputed = new Uint8Array(32).fill(7);
        expect(await toPayloadHash(precomputed)).toBe(precomputed);
        await expect(toPayloadHash(new Uint8Array(31))).rejects.toThrow(/32 bytes/);
    });
});

describe('retention parsing', () => {
    it('defaults to 24 hours', () => {
        expect(parseRetention(undefined)).toBe(86_400n);
    });

    it('accepts permanent, seconds and duration strings', () => {
        expect(parseRetention('permanent')).toBe(0n);
        expect(parseRetention(3_600)).toBe(3_600n);
        expect(parseRetention(3_600n)).toBe(3_600n);
        expect(parseRetention('30s')).toBe(30n);
        expect(parseRetention('15m')).toBe(900n);
        expect(parseRetention('24h')).toBe(86_400n);
        expect(parseRetention('30d')).toBe(2_592_000n);
    });

    it('rejects malformed values instead of coercing them', () => {
        // Cast because these are deliberately outside the `Retention` type: the point is
        // that a caller who reaches the parser with a bad runtime value is told so.
        expect(() => parseRetention('24 hours' as Retention)).toThrow(/could not parse/);
        expect(() => parseRetention(1.5)).toThrow(/whole number/);
        expect(() => parseRetention('abc' as Retention)).toThrow(/could not parse/);
    });

    it('enforces the program range', () => {
        expect(() => assertValidRetention(0n)).not.toThrow();
        expect(() => assertValidRetention(MIN_RETENTION_SECONDS)).not.toThrow();
        expect(() => assertValidRetention(MAX_RETENTION_SECONDS)).not.toThrow();
        expect(() => assertValidRetention(MIN_RETENTION_SECONDS - 1n)).toThrow(/out of range/);
        expect(() => assertValidRetention(MAX_RETENTION_SECONDS + 1n)).toThrow(/out of range/);
    });
});

describe('claim instruction encoding', () => {
    it('is 144 bytes with the documented field offsets', async () => {
        const nsHash = await namespaceHash('demo:counter');
        const keyHash = await idempotencyKeyHash('order_928');
        const payloadHash = await hashIntent({ n: 1 });
        const refund = FIXED_AUTHORITY;

        const data = encodeClaimData({
            namespaceHash: nsHash,
            idempotencyKeyHash: keyHash,
            payloadHash,
            retentionSeconds: 86_400n,
            refundDestination: refund,
        });

        expect(data.length).toBe(CLAIM_DATA_LENGTH);
        expect(data.length).toBe(144);
        expect(bytesToHex(data.subarray(0, 8))).toBe('3ec6d6c1d59f6cd2');
        expect(bytesToHex(data.subarray(8, 40))).toBe(bytesToHex(nsHash));
        expect(bytesToHex(data.subarray(40, 72))).toBe(bytesToHex(keyHash));
        expect(bytesToHex(data.subarray(72, 104))).toBe(bytesToHex(payloadHash));
        expect(new DataView(data.buffer, data.byteOffset).getBigUint64(104, true)).toBe(86_400n);
        expect(bytesToHex(data.subarray(112, 144))).toBe(
            bytesToHex(getAddressEncoder().encode(refund)),
        );
    });

    it('encodes retention as little-endian u64', () => {
        const data = encodeClaimData({
            namespaceHash: new Uint8Array(32),
            idempotencyKeyHash: new Uint8Array(32),
            payloadHash: new Uint8Array(32),
            retentionSeconds: 1n,
            refundDestination: FIXED_AUTHORITY,
        });
        expect(data[104]).toBe(1);
        expect(data[105]).toBe(0);
        expect(data[111]).toBe(0);
    });
});

describe('prepareIntent', () => {
    it('builds a pure guard instruction with the right accounts and roles', async () => {
        const guard = await prepareIntent({
            authority: FIXED_AUTHORITY,
            namespace: 'demo:counter',
            idempotencyKey: 'order_928',
            intent: { n: 1 },
        });

        expect(guard.receipt).toBe('7vMcWBtiMjeFgpx96E5ZtVZoYeRLn5Fu57RcTtzJeh9J');
        expect(guard.receiptBump).toBe(254);
        expect(guard.retentionSeconds).toBe(86_400n);
        expect(guard.refundDestination).toBe(FIXED_AUTHORITY);
        expect(guard.instruction.programAddress).toBe(COMMIT_ONCE_PROGRAM_ADDRESS);

        // Order matters: the program's `seeds` constraint references `authority`, so it
        // must be declared before `receipt`.
        expect(guard.instruction.accounts?.map((meta) => [meta.address, meta.role])).toEqual([
            [FIXED_AUTHORITY, 3], // WRITABLE_SIGNER
            [guard.receipt, 1], // WRITABLE
            ['Sysvar1nstructions1111111111111111111111111', 0], // READONLY
            ['11111111111111111111111111111111', 0], // READONLY
        ]);
    });

    it('needs no RPC, no prover and no indexer', async () => {
        // The point of the test is that this resolves with no network access at all: the
        // only I/O is WebCrypto hashing.
        const guard = await prepareIntent({
            authority: FIXED_AUTHORITY,
            namespace: 'anything',
            idempotencyKey: 'k',
            intent: 'payload',
        });
        expect(guard.instruction.data?.length).toBe(144);
    });

    it('defaults the refund destination to the authority but allows an override', async () => {
        const other = address('So11111111111111111111111111111111111111112');
        const guard = await prepareIntent({
            authority: FIXED_AUTHORITY,
            namespace: 'ns',
            idempotencyKey: 'k',
            intent: 'p',
            refundDestination: other,
        });
        expect(guard.refundDestination).toBe(other);
        // A different refund destination must not change the receipt address.
        const guardDefault = await prepareIntent({
            authority: FIXED_AUTHORITY,
            namespace: 'ns',
            idempotencyKey: 'k',
            intent: 'p',
        });
        expect(guard.receipt).toBe(guardDefault.receipt);
    });

    it('refuses a refund destination that is the receipt itself', async () => {
        const nsHash = await namespaceHash('ns');
        const keyHash = await idempotencyKeyHash('k');
        const [receipt] = await deriveReceiptAddress({
            authority: FIXED_AUTHORITY,
            namespaceHash: nsHash,
            idempotencyKeyHash: keyHash,
        });
        await expect(
            prepareIntent({
                authority: FIXED_AUTHORITY,
                namespace: 'ns',
                idempotencyKey: 'k',
                intent: 'p',
                refundDestination: receipt,
            }),
        ).rejects.toThrow(/receipt PDA/);
    });

    it('rejects an out-of-range retention before submitting anything', async () => {
        await expect(
            prepareIntent({
                authority: FIXED_AUTHORITY,
                namespace: 'ns',
                idempotencyKey: 'k',
                intent: 'p',
                retention: '1s',
            }),
        ).rejects.toThrow(/out of range/);
    });

    it('is stable: the same intent always derives the same instruction', async () => {
        const args = {
            authority: FIXED_AUTHORITY,
            namespace: 'demo:counter',
            idempotencyKey: 'order_928',
            intent: { n: 1 },
        } as const;
        const a = await prepareIntent(args);
        const b = await prepareIntent(args);
        expect(bytesToHex(a.instruction.data as Uint8Array)).toBe(
            bytesToHex(b.instruction.data as Uint8Array),
        );
    });
});

describe('receipt decoding', () => {
    /** Hand-build a receipt the way the program serializes it. */
    function buildReceipt(overrides: Partial<Record<string, bigint | number>> = {}): Uint8Array {
        const data = new Uint8Array(RECEIPT_ACCOUNT_SIZE);
        data.set(INTENT_RECEIPT_DISCRIMINATOR, 0);
        data[8] = (overrides.version as number) ?? RECEIPT_VERSION;
        data[9] = (overrides.bump as number) ?? 254;
        data.set(getAddressEncoder().encode(FIXED_AUTHORITY), 10);
        data.set(new Uint8Array(32).fill(1), 42);
        data.set(new Uint8Array(32).fill(2), 74);
        data.set(new Uint8Array(32).fill(3), 106);
        data.set(getAddressEncoder().encode(FIXED_AUTHORITY), 138);
        const view = new DataView(data.buffer);
        view.setBigUint64(170, (overrides.createdSlot as bigint) ?? 100n, true);
        view.setBigUint64(178, (overrides.expiresAtSlot as bigint) ?? 1_000n, true);
        view.setBigInt64(186, (overrides.createdUnixTimestamp as bigint) ?? 1_700_000_000n, true);
        view.setBigInt64(
            194,
            (overrides.expiresAtUnixTimestamp as bigint) ?? 1_700_086_400n,
            true,
        );
        return data;
    }

    it('recognises and decodes a receipt', () => {
        const data = buildReceipt();
        expect(isIntentReceipt(data)).toBe(true);
        const receipt = decodeIntentReceipt(data);
        expect(receipt.version).toBe(RECEIPT_VERSION);
        expect(receipt.bump).toBe(254);
        expect(receipt.authority).toBe(FIXED_AUTHORITY);
        expect(receipt.namespaceHash).toEqual(new Uint8Array(32).fill(1));
        expect(receipt.payloadHash).toEqual(new Uint8Array(32).fill(3));
        expect(receipt.refundDestination).toBe(FIXED_AUTHORITY);
        expect(receipt.createdSlot).toBe(100n);
        expect(receipt.expiresAtSlot).toBe(1_000n);
        expect(isPermanentReceipt(receipt)).toBe(false);
    });

    it('rejects anything that is not a receipt', () => {
        expect(isIntentReceipt(new Uint8Array(202))).toBe(false);
        expect(() => decodeIntentReceipt(new Uint8Array(202))).toThrow(ReceiptDecodeError);
        expect(() => decodeIntentReceipt(new Uint8Array(64))).toThrow(ReceiptDecodeError);
    });

    it('rejects a receipt of the wrong size', () => {
        const data = buildReceipt();
        expect(() => decodeIntentReceipt(data.subarray(0, 200))).toThrow(ReceiptDecodeError);
    });

    it('treats expiresAtSlot === 0 as permanent', () => {
        const receipt = decodeIntentReceipt(
            buildReceipt({ expiresAtSlot: 0n, expiresAtUnixTimestamp: 0n }),
        );
        expect(isPermanentReceipt(receipt)).toBe(true);
        expect(isClosable(receipt, { slot: 10n ** 12n, unixTimestamp: 10n ** 12n })).toBe(false);
    });

    it('requires BOTH deadlines before a receipt is closable', () => {
        const receipt = decodeIntentReceipt(buildReceipt());
        // Slot gate passed, wall clock not yet: not closable.
        expect(isClosable(receipt, { slot: 5_000n, unixTimestamp: 1_700_000_000n })).toBe(false);
        // Wall clock passed, slot gate not yet: not closable.
        expect(isClosable(receipt, { slot: 100n, unixTimestamp: 2_000_000_000n })).toBe(false);
        // Both passed: closable.
        expect(isClosable(receipt, { slot: 1_000n, unixTimestamp: 1_700_086_400n })).toBe(true);
    });
});

describe('error classification', () => {
    it('maps every documented code', () => {
        expect(COMMIT_ONCE_ERROR_CODES.AlreadyCommitted).toBe(6000);
        expect(COMMIT_ONCE_ERROR_CODES.IdempotencyConflict).toBe(6001);
        expect(COMMIT_ONCE_ERROR_CODES.DurableNonceUnsupported).toBe(6002);
        expect(COMMIT_ONCE_ERROR_CODES.InvalidRetention).toBe(6003);
        expect(COMMIT_ONCE_ERROR_CODES.InvalidRefundDestination).toBe(6004);
        expect(COMMIT_ONCE_ERROR_CODES.InvalidReceiptOwner).toBe(6005);
        expect(COMMIT_ONCE_ERROR_CODES.InvalidReceiptData).toBe(6006);
        expect(COMMIT_ONCE_ERROR_CODES.InvalidReceiptAuthority).toBe(6007);
        expect(COMMIT_ONCE_ERROR_CODES.UnsupportedReceiptVersion).toBe(6008);
        expect(COMMIT_ONCE_ERROR_CODES.ReceiptNotExpired).toBe(6009);
        expect(COMMIT_ONCE_ERROR_CODES.ReceiptIsPermanent).toBe(6010);
    });

    it('classifies a nested InstructionError payload', () => {
        const error = {
            context: { err: { InstructionError: [0, { Custom: 6000 }] } },
        };
        const classified = classifyError(error);
        expect(classified.kind).toBe('commit-once');
        expect(classified.kind === 'commit-once' && classified.name).toBe('AlreadyCommitted');
        expect(isAlreadyCommitted(error)).toBe(true);
        expect(isIdempotencyConflict(error)).toBe(false);
    });

    it('classifies a hex custom-program-error message', () => {
        expect(classifyError(new Error('custom program error: 0x1771')).kind).toBe('commit-once');
        expect(isIdempotencyConflict(new Error('custom program error: 0x1771'))).toBe(true);
    });

    it('reports unknown errors as other rather than guessing', () => {
        const classified = classifyError(new Error('blockhash not found'));
        expect(classified).toEqual({ kind: 'other', code: null });
        expect(isAlreadyCommitted(new Error('blockhash not found'))).toBe(false);
    });
});

describe('byte helpers', () => {
    it('round-trips hex', () => {
        const bytes = new Uint8Array([0, 1, 127, 128, 255]);
        expect(bytesToHex(bytes)).toBe('00017f80ff');
        expect(hexToBytes('00017f80ff')).toEqual(bytes);
        expect(hexToBytes('0x00017F80FF')).toEqual(bytes);
    });

    it('rejects malformed hex', () => {
        expect(() => hexToBytes('abc')).toThrow(/odd length/);
        expect(() => hexToBytes('zz')).toThrow(/invalid hex/);
    });

    it('exposes sha256 over raw bytes', async () => {
        expect(bytesToHex(await sha256(utf8('increment')))).toBe(
            'f679230253e596b02442b1ca20083da5efd7bf5dfe48a9814afb6fe8ebe58bc9',
        );
    });
});

describe('costs', () => {
    it('reports the mainnet rent deposit exactly', () => {
        // (202 data bytes + 128 account overhead) * 5080 lamports/byte, since SIMD-0437.
        expect(RECEIPT_RENT_LAMPORTS).toBe(1_676_400n);
        expect(RECEIPT_ACCOUNT_SIZE).toBe(202);
    });
});

function replacer(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? `${value}n` : value;
}
