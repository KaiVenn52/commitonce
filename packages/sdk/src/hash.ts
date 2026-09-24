/**
 * Hashing and canonical intent encoding.
 *
 * ## What "the same intent" means
 *
 * A receipt stores a 32-byte **payload fingerprint** alongside the key. Reusing a key with
 * a different fingerprint is reported as an idempotency conflict rather than silently
 * treated as a duplicate, which is what turns "did I already do this?" into a question the
 * chain can answer.
 *
 * The fingerprint must cover the *semantic* content of the action and nothing else.
 * Specifically it must **not** include transport details — blockhash, signature, priority
 * fee, compute budget, retry count, or submission route. Those change on every rebuild and
 * including them would make a retry look like a different intent, defeating the entire
 * purpose of the guard.
 *
 * ## Encoding
 *
 * `encodeIntent` produces a deterministic, injective, length-prefixed byte encoding. Every
 * token is `<tag><length>:<payload>`, so no value can be confused with another:
 *
 * | Value      | Encoding                                     |
 * | ---------- | -------------------------------------------- |
 * | `null`     | `z`                                          |
 * | `false`    | `f`                                          |
 * | `true`     | `t`                                          |
 * | number     | `d<len>:<decimal>` (finite only)             |
 * | bigint     | `i<len>:<decimal>`                           |
 * | string     | `s<byteLen>:<utf8>`                          |
 * | bytes      | `b<byteLen>:<raw bytes>`                     |
 * | array      | `a<count>:` then each element                |
 * | object     | `o<count>:` then each `key`,`value` pair     |
 *
 * Object keys are sorted by UTF-16 code unit so the encoding does not depend on insertion
 * order or locale.
 *
 * ## Deliberate choices
 *
 * * **`undefined` throws.** Silently dropping it (as `JSON.stringify` does) could make two
 *   genuinely different intents encode identically, which would suppress a conflict that
 *   should have been reported. Failing loudly is the safer default.
 * * **`-0` and `0` encode identically**, matching JavaScript's own `String(-0) === '0'`.
 * * **Floating point is not decimal-exact.** For token amounts and lamports, pass a
 *   `bigint` (or a decimal string) rather than a `number`.
 *
 * ## Dependencies
 *
 * Hashing uses WebCrypto (`globalThis.crypto.subtle`), which is available in Node 18+, all
 * modern browsers, Deno, Bun and workers. That keeps this package free of runtime
 * dependencies and avoids pulling a hash implementation into every consumer's bundle. The
 * cost is that hashing is asynchronous — which is not a real cost here, because PDA
 * derivation and RPC access are asynchronous anyway. Callers who need a synchronous path
 * can compute the 32-byte hashes themselves and pass them to the low-level API.
 */

import { IDEMPOTENCY_KEY_DOMAIN, NAMESPACE_DOMAIN } from './constants.js';

const textEncoder = new TextEncoder();

/**
 * Any byte sequence.
 *
 * Structural rather than `Uint8Array` because `@solana/kit` returns
 * `ReadonlyUint8Array`, which is not assignable to `Uint8Array` (it lacks the mutating
 * methods). Accepting both keeps callers from having to cast at every call site.
 */
export type ByteSequence = Iterable<number> & { readonly length: number };

/** A value that can be canonically encoded into an intent fingerprint. */
export type CanonicalIntent =
    | null
    | boolean
    | string
    | number
    | bigint
    | Uint8Array
    | readonly CanonicalIntent[]
    | { readonly [key: string]: CanonicalIntent };

/**
 * Return the platform's `SubtleCrypto`, or throw an error that explains exactly what is
 * wrong and what to do about it.
 */
export function getSubtleCrypto(): SubtleCrypto {
    const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
    if (!subtle) {
        throw new Error(
            'CommitOnce: WebCrypto is unavailable (globalThis.crypto.subtle is undefined). ' +
                'Node 18+, modern browsers, Deno and Bun all provide it. In a browser it also ' +
                'requires a secure context (https, or localhost). If it cannot be enabled, ' +
                'derive the 32-byte hashes with your own SHA-256 and use the synchronous ' +
                'low-level path instead: `encodeClaimData` (from this package) plus ' +
                '`deriveReceiptAddress` for the PDA, then build the Instruction yourself.',
        );
    }
    return subtle;
}

/** SHA-256 of the given bytes. */
export async function sha256(data: ByteSequence): Promise<Uint8Array> {
    // `SubtleCrypto.digest` is typed against the ambient `BufferSource`, which differs
    // between the DOM and Node type libraries. Deriving the parameter type from the
    // method itself keeps this package typechecking under either.
    type DigestInput = Parameters<SubtleCrypto['digest']>[1];
    const digest = await getSubtleCrypto().digest('SHA-256', data as DigestInput);
    return new Uint8Array(digest);
}

async function domainSeparatedHash(domain: string, value: string): Promise<Uint8Array> {
    const domainBytes = textEncoder.encode(domain);
    const valueBytes = textEncoder.encode(value);
    const buffer = new Uint8Array(domainBytes.length + valueBytes.length);
    buffer.set(domainBytes, 0);
    buffer.set(valueBytes, domainBytes.length);
    return sha256(buffer);
}

/**
 * `sha256("commitonce/namespace/v1" || namespace_utf8)`.
 *
 * The domain separator means a namespace hash can never collide with a key hash, so an
 * application cannot accidentally shadow another application's key space by choosing a
 * colliding string.
 */
export function namespaceHash(namespace: string): Promise<Uint8Array> {
    return domainSeparatedHash(NAMESPACE_DOMAIN, namespace);
}

/** `sha256("commitonce/key/v1" || idempotency_key_utf8)`. */
export function idempotencyKeyHash(idempotencyKey: string): Promise<Uint8Array> {
    return domainSeparatedHash(IDEMPOTENCY_KEY_DOMAIN, idempotencyKey);
}

type Chunk = string | Uint8Array;

function encodeValue(value: CanonicalIntent, chunks: Chunk[]): void {
    if (value === null) {
        chunks.push('z');
        return;
    }

    switch (typeof value) {
        case 'boolean':
            chunks.push(value ? 't' : 'f');
            return;
        case 'string': {
            const bytes = textEncoder.encode(value);
            chunks.push(`s${bytes.length}:`, bytes);
            return;
        }
        case 'number': {
            if (!Number.isFinite(value)) {
                throw new TypeError(
                    `CommitOnce: intent contains a non-finite number (${String(value)}). ` +
                        'Only finite numbers can be canonically encoded.',
                );
            }
            /**
             * An integer outside the safe range is refused rather than encoded.
             *
             * `Number("9007199254740993")` is `9007199254740992`, and `String` of that is
             * `"9007199254740992"` — so a caller who parses a large amount out of a string gets a
             * **silently different number**, and this SDK would fingerprint it. The fingerprint
             * would then describe an intent nobody wrote, which is the one thing the payload hash
             * exists to prevent.
             *
             * The check cannot tell a deliberate `1e21` from a lost-precision parse, and it
             * refuses both. That is the right trade for a fingerprint: an integer beyond 2^53 is
             * far more likely to be a parse artifact than a value someone meant exactly, and
             * `bigint` — which is exact and already supported — is the correct type. The error
             * says so.
             *
             * Non-integers are unaffected: `1.5` is exactly representable and encodes as `1.5`.
             */
            if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
                throw new TypeError(
                    `CommitOnce: intent contains the integer ${String(value)}, which is outside ` +
                        'the safe range (±2^53 − 1) and may not be the number you wrote. ' +
                        '`Number("9007199254740993")` is `9007199254740992`, so a parsed large ' +
                        'amount silently changes and the fingerprint would describe an intent ' +
                        'nobody wrote. Pass it as a `bigint` — `9007199254740993n` — which is ' +
                        'exact and encodes differently from its neighbours.',
                );
            }
            const repr = String(value);
            chunks.push(`d${repr.length}:${repr}`);
            return;
        }
        case 'bigint': {
            const repr = value.toString();
            chunks.push(`i${repr.length}:${repr}`);
            return;
        }
        case 'object':
            break;
        case 'undefined':
            throw new TypeError(
                'CommitOnce: intent contains `undefined`. Dropping it would let two ' +
                    'different intents encode identically and hide a conflict. Remove the ' +
                    'property or use an explicit null.',
            );
        default:
            throw new TypeError(
                `CommitOnce: intent contains an unsupported value of type ${typeof value}. ` +
                    'Only null, boolean, string, number, bigint, Uint8Array, arrays and plain ' +
                    'objects can be hashed.',
            );
    }

    if (value instanceof Uint8Array) {
        chunks.push(`b${value.length}:`, value);
        return;
    }

    if (Array.isArray(value)) {
        chunks.push(`a${value.length}:`);
        for (const item of value) {
            encodeValue(item as CanonicalIntent, chunks);
        }
        return;
    }

    if (value instanceof Date || value instanceof Map || value instanceof Set) {
        throw new TypeError(
            'CommitOnce: Date, Map and Set are not canonically encodable. Convert them to a ' +
                'string/number or a plain object first.',
        );
    }

    const source = value as Record<string, CanonicalIntent>;
    const keys = Object.keys(source).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    chunks.push(`o${keys.length}:`);
    for (const key of keys) {
        const keyBytes = textEncoder.encode(key);
        chunks.push(`s${keyBytes.length}:`, keyBytes);
        encodeValue(source[key] as CanonicalIntent, chunks);
    }
}

function concatChunks(chunks: readonly Chunk[]): Uint8Array {
    let total = 0;
    for (const chunk of chunks) {
        total += typeof chunk === 'string' ? textEncoder.encode(chunk).length : chunk.length;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        const bytes = typeof chunk === 'string' ? textEncoder.encode(chunk) : chunk;
        out.set(bytes, offset);
        offset += bytes.length;
    }
    return out;
}

/**
 * Deterministically encode an intent into bytes.
 *
 * Exported because it is the single definition of "the same intent" and is worth being
 * able to inspect, log, and test directly.
 */
export function encodeIntent(intent: CanonicalIntent): Uint8Array {
    const chunks: Chunk[] = [];
    encodeValue(intent, chunks);
    return concatChunks(chunks);
}

/** `sha256(encodeIntent(intent))` — the 32-byte payload fingerprint stored onchain. */
export async function hashIntent(intent: CanonicalIntent): Promise<Uint8Array> {
    return sha256(encodeIntent(intent));
}

/**
 * Normalise the `intent` argument accepted by the high-level API.
 *
 * A 32-byte `Uint8Array` is taken as an already-computed fingerprint. Anything else is
 * canonically encoded and hashed. To fingerprint raw bytes as *content*, wrap them:
 * `{ data: bytes }`.
 */
export async function toPayloadHash(intent: CanonicalIntent | Uint8Array): Promise<Uint8Array> {
    if (intent instanceof Uint8Array) {
        if (intent.length !== 32) {
            throw new RangeError(
                `CommitOnce: a Uint8Array passed as \`intent\` is treated as a precomputed ` +
                    `payload fingerprint and must be 32 bytes, got ${intent.length}. To hash ` +
                    'raw bytes as content, wrap them: { data: bytes }.',
            );
        }
        return intent;
    }
    return hashIntent(intent);
}

/** Lowercase hex, for logs, tests and error messages. */
export function bytesToHex(bytes: ByteSequence): string {
    let out = '';
    for (const byte of bytes) {
        out += byte.toString(16).padStart(2, '0');
    }
    return out;
}

/** Parse lowercase or uppercase hex into bytes. */
export function hexToBytes(hex: string): Uint8Array {
    const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (normalized.length % 2 !== 0) {
        throw new RangeError(`CommitOnce: hex string has odd length (${normalized.length})`);
    }
    const out = new Uint8Array(normalized.length / 2);
    for (let i = 0; i < out.length; i += 1) {
        const byte = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
        if (Number.isNaN(byte)) {
            throw new RangeError(`CommitOnce: invalid hex at offset ${i * 2}`);
        }
        out[i] = byte;
    }
    return out;
}
