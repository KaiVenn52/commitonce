/**
 * Event decoding.
 *
 * CommitOnce emits two Anchor events. Until now the SDK could build and inspect *accounts*
 * but not read its own events, which meant an integration that wanted to react to a commit —
 * an indexer, a webhook, a confirmation UI — had to hand-roll the Borsh layout. This module
 * closes that gap.
 *
 * ## Where an event actually lives
 *
 * An event is not an account and not a return value. Anchor emits it as a program log line:
 *
 * ```text
 * Program data: <base64>
 * ```
 *
 * where the decoded bytes are an 8-byte discriminator (`sha256("event:<Name>")[0..8]`)
 * followed by the Borsh-encoded body. So reading events means reading
 * `meta.logMessages` from a transaction — and **a log line is the only place they exist**.
 *
 * ## Why the layout is hardcoded
 *
 * The SDK has no runtime dependency and no IDL round trip, so the layouts are written out
 * below and pinned by tests. `test/events.test.ts` decodes bytes emitted by the real deployed
 * program on devnet, so these offsets are checked against the chain rather than against a
 * document.
 *
 * ## Borsh layouts
 *
 * ```text
 * IntentCommitted (192 bytes)
 *   0    32   authority
 *   32   32   namespace_hash
 *   64   32   idempotency_key_hash
 *   96   32   payload_hash
 *   128  32   refund_destination
 *   160  8    created_slot           (u64 LE)
 *   168  8    expires_at_slot        (u64 LE, 0 = permanent)
 *   176  8    created_unix_ts        (i64 LE)
 *   184  8    expires_at_unix_ts     (i64 LE, 0 = permanent)
 *
 * IntentReceiptClosed (136 bytes)
 *   0    32   authority
 *   32   32   namespace_hash
 *   64   32   idempotency_key_hash
 *   96   32   payload_hash
 *   128  8    closed_slot            (u64 LE)
 * ```
 */

import { getAddressDecoder, type Address } from '@solana/kit';
import {
    INTENT_COMMITTED_EVENT_DISCRIMINATOR,
    INTENT_COMMITTED_EVENT_SIZE,
    INTENT_RECEIPT_CLOSED_EVENT_DISCRIMINATOR,
    INTENT_RECEIPT_CLOSED_EVENT_SIZE,
    PROGRAM_DATA_LOG_PREFIX,
} from './constants.js';

const addressDecoder = getAddressDecoder();

/** A decoded `IntentCommitted` event. */
export type IntentCommittedEvent = {
    readonly authority: Address;
    readonly namespaceHash: Uint8Array;
    readonly idempotencyKeyHash: Uint8Array;
    readonly payloadHash: Uint8Array;
    readonly refundDestination: Address;
    readonly createdSlot: bigint;
    readonly expiresAtSlot: bigint;
    readonly createdUnixTimestamp: bigint;
    readonly expiresAtUnixTimestamp: bigint;
};

/** A decoded `IntentReceiptClosed` event. */
export type IntentReceiptClosedEvent = {
    readonly authority: Address;
    readonly namespaceHash: Uint8Array;
    readonly idempotencyKeyHash: Uint8Array;
    readonly payloadHash: Uint8Array;
    readonly closedSlot: bigint;
};

/** Either CommitOnce event, tagged by name. */
export type CommitOnceEvent =
    | { readonly name: 'IntentCommitted'; readonly data: IntentCommittedEvent }
    | { readonly name: 'IntentReceiptClosed'; readonly data: IntentReceiptClosedEvent };

/** Raised when bytes or a log line cannot be decoded as a CommitOnce event. */
export class EventDecodeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'EventDecodeError';
    }
}

// ---------------------------------------------------------------------------
// base64
// ---------------------------------------------------------------------------

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * A lookup table for decoding, built once.
 *
 * The URL-safe alphabet (`-` and `_`) is accepted as well, because some RPC providers and
 * log exporters re-encode base64. Accepting both costs two assignments and removes a class
 * of "works on my RPC" failure.
 */
const BASE64_LOOKUP: Int16Array = (() => {
    const table = new Int16Array(256).fill(-1);
    for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
        table[BASE64_ALPHABET.charCodeAt(i)] = i;
    }
    table['-'.charCodeAt(0)] = 62;
    table['_'.charCodeAt(0)] = 63;
    return table;
})();

/**
 * Decode standard or URL-safe base64 to bytes, without a dependency.
 *
 * Written out rather than delegating to `atob` or `Buffer`, because those are not both
 * present in every runtime this package supports and the SDK's zero-dependency property is
 * worth more than twenty lines. Padding is optional; whitespace is ignored.
 */
export function base64ToBytes(input: string): Uint8Array {
    const out = new Uint8Array(Math.floor((input.length * 6) / 8));
    let outIndex = 0;
    let buffer = 0;
    let bits = 0;

    for (let i = 0; i < input.length; i += 1) {
        const code = input.charCodeAt(i);
        if (code === 61 /* '=' */) {
            break; // padding: everything after it is padding
        }
        if (code === 32 || code === 9 || code === 10 || code === 13) {
            continue; // whitespace, including a wrapped log line
        }
        const value = BASE64_LOOKUP[code];
        if (value === undefined || value < 0) {
            throw new EventDecodeError(
                `Invalid base64 character ${JSON.stringify(input[i])} at index ${i}.`,
            );
        }
        buffer = ((buffer << 6) | value) & 0xff_ffff; // keep at most 24 bits live
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[outIndex] = (buffer >> bits) & 0xff;
            outIndex += 1;
        }
    }

    return outIndex === out.length ? out : out.slice(0, outIndex);
}

// ---------------------------------------------------------------------------
// decoding
// ---------------------------------------------------------------------------

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

/** `true` if `data` begins with the `IntentCommitted` discriminator. */
export function isIntentCommittedEvent(data: Uint8Array): boolean {
    return (
        data.length >= 8 && bytesEqual(data.subarray(0, 8), INTENT_COMMITTED_EVENT_DISCRIMINATOR)
    );
}

/** `true` if `data` begins with the `IntentReceiptClosed` discriminator. */
export function isIntentReceiptClosedEvent(data: Uint8Array): boolean {
    return (
        data.length >= 8 &&
        bytesEqual(data.subarray(0, 8), INTENT_RECEIPT_CLOSED_EVENT_DISCRIMINATOR)
    );
}

/**
 * Decode an `IntentCommitted` event body from the bytes **after** the discriminator.
 *
 * @param body the 192 Borsh-encoded bytes
 */
export function decodeIntentCommittedBody(body: Uint8Array): IntentCommittedEvent {
    if (body.length !== INTENT_COMMITTED_EVENT_SIZE) {
        throw new EventDecodeError(
            `IntentCommitted body must be ${INTENT_COMMITTED_EVENT_SIZE} bytes, got ${body.length}.`,
        );
    }
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    return {
        authority: addressDecoder.decode(body.subarray(0, 32)),
        namespaceHash: body.slice(32, 64),
        idempotencyKeyHash: body.slice(64, 96),
        payloadHash: body.slice(96, 128),
        refundDestination: addressDecoder.decode(body.subarray(128, 160)),
        createdSlot: view.getBigUint64(160, true),
        expiresAtSlot: view.getBigUint64(168, true),
        createdUnixTimestamp: view.getBigInt64(176, true),
        expiresAtUnixTimestamp: view.getBigInt64(184, true),
    };
}

/**
 * Decode an `IntentReceiptClosed` event body from the bytes **after** the discriminator.
 *
 * @param body the 136 Borsh-encoded bytes
 */
export function decodeIntentReceiptClosedBody(body: Uint8Array): IntentReceiptClosedEvent {
    if (body.length !== INTENT_RECEIPT_CLOSED_EVENT_SIZE) {
        throw new EventDecodeError(
            `IntentReceiptClosed body must be ${INTENT_RECEIPT_CLOSED_EVENT_SIZE} bytes, got ${body.length}.`,
        );
    }
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    return {
        authority: addressDecoder.decode(body.subarray(0, 32)),
        namespaceHash: body.slice(32, 64),
        idempotencyKeyHash: body.slice(64, 96),
        payloadHash: body.slice(96, 128),
        closedSlot: view.getBigUint64(128, true),
    };
}

/**
 * Decode a CommitOnce event from bytes that include the 8-byte discriminator.
 *
 * Returns `null` for anything that is not a CommitOnce event, because a transaction's logs
 * legitimately contain other programs' events — the demo program emits its own, and a
 * `Program data:` line is not self-identifying. Throwing here would make this unusable for
 * its main purpose, which is scanning a transaction's logs.
 *
 * Throws {@link EventDecodeError} only when the discriminator *does* match but the body is
 * malformed, since that is a real disagreement worth surfacing.
 */
export function decodeCommitOnceEvent(data: Uint8Array): CommitOnceEvent | null {
    if (isIntentCommittedEvent(data)) {
        return {
            name: 'IntentCommitted',
            data: decodeIntentCommittedBody(data.subarray(8)),
        };
    }
    if (isIntentReceiptClosedEvent(data)) {
        return {
            name: 'IntentReceiptClosed',
            data: decodeIntentReceiptClosedBody(data.subarray(8)),
        };
    }
    return null;
}

/**
 * Decode a single `Program data:` log line.
 *
 * Returns `null` if the line is not a program-data line or not a CommitOnce event.
 */
export function decodeEventFromLogLine(line: string): CommitOnceEvent | null {
    const index = line.indexOf(PROGRAM_DATA_LOG_PREFIX);
    if (index < 0) {
        return null;
    }
    const base64 = line.slice(index + PROGRAM_DATA_LOG_PREFIX.length).trim();
    if (base64 === '') {
        return null;
    }
    return decodeCommitOnceEvent(base64ToBytes(base64));
}

/**
 * Decode every CommitOnce event in a transaction's log messages, in order.
 *
 * This is the function most callers want:
 *
 * ```ts
 * const events = decodeEventsFromLogs(meta.logMessages ?? []);
 * const committed = events.find((e) => e.name === 'IntentCommitted');
 * ```
 *
 * Lines that are not CommitOnce events are skipped silently — including other programs'
 * events and the ordinary `Program log:` narration. A malformed *CommitOnce* event still
 * throws, because silently dropping one would hide a real version mismatch.
 */
export function decodeEventsFromLogs(logs: readonly string[]): CommitOnceEvent[] {
    const events: CommitOnceEvent[] = [];
    for (const line of logs) {
        const event = decodeEventFromLogLine(line);
        if (event !== null) {
            events.push(event);
        }
    }
    return events;
}
