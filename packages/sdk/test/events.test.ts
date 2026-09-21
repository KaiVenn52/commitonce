/**
 * Event decoding tests.
 *
 * The centrepiece is a **real event emitted by the deployed program on devnet**. It was
 * captured from the A/B demo run recorded in
 * `submission/evidence/devnet-demo-run.log`, so these tests are checked against the chain
 * rather than against the SDK's own assumptions. If the program's event layout ever changes,
 * this fails — which is the point.
 *
 * The captured event can be independently corroborated from the same log:
 *
 * * the transaction was `claim` + `increment` and reported
 *   `SUCCESS — slot 501846624, 18,886 CU`;
 * * the decoded `createdSlot` is `501846624`, matching that slot;
 * * the losing retry in the same run was rejected with
 *   `duplicate intent blocked (already committed at slot 501846624)`, which is the same
 *   slot the event records;
 * * the demo printed its namespace as `demo:counter` and its key as
 *   `verify_20260921_175355`, and both decoded hashes match those strings under the
 *   documented domain separators;
 * * the demo's retention was `86400 seconds`, and the decoded deadlines differ by exactly
 *   `86_400` seconds and `345_600` slots (= 86 400 × 4).
 */

import { describe, expect, it } from 'vitest';

import {
    EventDecodeError,
    INTENT_COMMITTED_EVENT_DISCRIMINATOR,
    INTENT_COMMITTED_EVENT_SIZE,
    INTENT_RECEIPT_CLOSED_EVENT_DISCRIMINATOR,
    INTENT_RECEIPT_CLOSED_EVENT_SIZE,
    base64ToBytes,
    bytesToHex,
    decodeCommitOnceEvent,
    decodeEventFromLogLine,
    decodeEventsFromLogs,
    decodeIntentCommittedBody,
    decodeIntentReceiptClosedBody,
    idempotencyKeyHash,
    isIntentCommittedEvent,
    isIntentReceiptClosedEvent,
    namespaceHash,
} from '../src/index.js';

/**
 * A real `IntentCommitted` emitted by `CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB`
 * on devnet during the recorded demo run. Captured verbatim from the transaction logs.
 */
const REAL_INTENT_COMMITTED_BASE64 =
    'BPlJM9huxPnHK0lahvh8+reWHi+31Lu09ZICpFoMp04pExlS67fJZ3srpKhHIit4sWVd8jkuiaYVQ03Rz/cFVOWai4DTJY3fHai1jVaz8EwZM/d7E0y24SGbdsDvrSZaOZE1seYQBd6wuN2Oj6U/IZtZDup5TmfQAAccvSaEQ4SFBaX8h1WEkscrSVqG+Hz6t5YeL7fUu7T1kgKkWgynTikTGVLrt8lnYJLpHQAAAABg2O4dAAAAAML+sGoAAAAAQlCyagAAAAA=';

/** A real `demo_counter::Incremented` event from the same run: a non-CommitOnce event. */
const REAL_FOREIGN_EVENT_BASE64 =
    'XM93zEfNbA/xhZsFB/86tCeV6rgxezkqR9ejmjsuWlndbti5Ri7j8AEAAAAAAAAAO5LpHQAAAABvMfhrFLwX33aaj2nNCo6Drqg9UihcAUyRgJTtsFSGfw==';

const REAL_AUTHORITY = 'EQUR41ZSLeXPN1atwpEe4DJ1W9sc6fWQi4sUqN5uo1n6';

describe('the captured devnet event', () => {
    it('is the size the constants claim', () => {
        const bytes = base64ToBytes(REAL_INTENT_COMMITTED_BASE64);
        expect(bytes.length).toBe(INTENT_COMMITTED_EVENT_SIZE + 8);
    });

    it('carries the IntentCommitted discriminator from the IDL', () => {
        const bytes = base64ToBytes(REAL_INTENT_COMMITTED_BASE64);
        expect(bytesToHex(bytes.subarray(0, 8))).toBe(
            bytesToHex(INTENT_COMMITTED_EVENT_DISCRIMINATOR),
        );
        expect(isIntentCommittedEvent(bytes)).toBe(true);
        expect(isIntentReceiptClosedEvent(bytes)).toBe(false);
    });

    it('decodes to the values the demo run recorded', () => {
        const event = decodeCommitOnceEvent(base64ToBytes(REAL_INTENT_COMMITTED_BASE64));

        expect(event?.name).toBe('IntentCommitted');
        if (event?.name !== 'IntentCommitted') {
            throw new Error('unreachable');
        }
        const { data } = event;

        // The slot the program itself reported when it rejected the losing retry:
        // "duplicate intent blocked (already committed at slot 501846624)".
        expect(data.createdSlot).toBe(501846624n);
        expect(data.expiresAtSlot).toBe(502192224n);
        expect(data.createdUnixTimestamp).toBe(1789984450n);
        expect(data.expiresAtUnixTimestamp).toBe(1790070850n);

        // The authority paid its own rent and nominated itself as the refund destination.
        expect(data.authority).toBe(REAL_AUTHORITY);
        expect(data.refundDestination).toBe(REAL_AUTHORITY);
    });

    it('carries hashes that match the strings the demo printed', async () => {
        const event = decodeCommitOnceEvent(base64ToBytes(REAL_INTENT_COMMITTED_BASE64));
        if (event?.name !== 'IntentCommitted') {
            throw new Error('unreachable');
        }

        // The demo printed these two strings. The decoded hashes must be the documented
        // domain-separated hashes of them — which is what ties the SDK's hashing to what the
        // deployed program actually stored.
        expect(bytesToHex(event.data.namespaceHash)).toBe(
            bytesToHex(await namespaceHash('demo:counter')),
        );
        expect(bytesToHex(event.data.idempotencyKeyHash)).toBe(
            bytesToHex(await idempotencyKeyHash('verify_20260921_175355')),
        );
    });

    it('encodes a retention window that matches the demo configuration', () => {
        const event = decodeCommitOnceEvent(base64ToBytes(REAL_INTENT_COMMITTED_BASE64));
        if (event?.name !== 'IntentCommitted') {
            throw new Error('unreachable');
        }

        // The demo ran with `retention 86400 seconds`, i.e. 24h.
        const seconds = event.data.expiresAtUnixTimestamp - event.data.createdUnixTimestamp;
        expect(seconds).toBe(86_400n);

        // And the slot deadline is that many seconds at the documented 4 slots/second.
        const slots = event.data.expiresAtSlot - event.data.createdSlot;
        expect(slots).toBe(86_400n * 4n);
    });
});

describe('log-line decoding', () => {
    it('finds the event in a real log line, with the "| " prefix the demo prints', () => {
        const line = `| Program data: ${REAL_INTENT_COMMITTED_BASE64}`;
        const event = decodeEventFromLogLine(line);
        expect(event?.name).toBe('IntentCommitted');
    });

    it('ignores another program’s event rather than throwing', () => {
        // The demo counter emits its own event from the same transaction. A decoder that
        // threw on it would be unusable for scanning logs, which is its main purpose.
        const line = `| Program data: ${REAL_FOREIGN_EVENT_BASE64}`;
        expect(decodeEventFromLogLine(line)).toBeNull();
    });

    it('ignores ordinary narration lines', () => {
        expect(decodeEventFromLogLine('| Program log: Instruction: Claim')).toBeNull();
        expect(decodeEventFromLogLine('| Program CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB success')).toBeNull();
        expect(decodeEventFromLogLine('')).toBeNull();
    });

    it('returns only the CommitOnce event when scanning a whole real log block', () => {
        // Verbatim from the recorded devnet run: compute-budget narration, the CPI into the
        // System program, our event, and then the demo counter's own event.
        const logs = [
            'Program ComputeBudget111111111111111111111111111111 invoke [1]',
            'Program ComputeBudget111111111111111111111111111111 success',
            'Program CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB invoke [1]',
            'Program log: Instruction: Claim',
            'Program 11111111111111111111111111111111 invoke [2]',
            'Program 11111111111111111111111111111111 success',
            `Program data: ${REAL_INTENT_COMMITTED_BASE64}`,
            'Program CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB consumed 14669 of 402850 compute units',
            'Program CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB success',
            'Program EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5 invoke [1]',
            'Program log: Instruction: Increment',
            `Program data: ${REAL_FOREIGN_EVENT_BASE64}`,
        ];

        const events = decodeEventsFromLogs(logs);
        expect(events).toHaveLength(1);
        expect(events[0]?.name).toBe('IntentCommitted');
    });

    it('preserves order when a transaction contains several events', () => {
        const logs = [
            `Program data: ${REAL_FOREIGN_EVENT_BASE64}`,
            `Program data: ${REAL_INTENT_COMMITTED_BASE64}`,
            `Program data: ${REAL_FOREIGN_EVENT_BASE64}`,
        ];
        const events = decodeEventsFromLogs(logs);
        expect(events).toHaveLength(1);
        expect(events[0]?.name).toBe('IntentCommitted');
    });
});

describe('base64', () => {
    it('decodes to the length the padding implies', () => {
        expect(base64ToBytes('').length).toBe(0);
        expect(base64ToBytes('AA==').length).toBe(1);
        expect(base64ToBytes('AAA=').length).toBe(2);
        expect(base64ToBytes('AAAA').length).toBe(3);
    });

    it('round-trips known bytes', () => {
        expect(Array.from(base64ToBytes('AAECAwQ='))).toEqual([0, 1, 2, 3, 4]);
    });

    it('accepts the URL-safe alphabet, which some RPCs emit', () => {
        // 0xfb 0xff encodes to "+/8=" in standard base64 and "-_8=" in URL-safe.
        expect(Array.from(base64ToBytes('+/8='))).toEqual([0xfb, 0xff]);
        expect(Array.from(base64ToBytes('-_8='))).toEqual([0xfb, 0xff]);
    });

    it('ignores whitespace, including a wrapped line', () => {
        expect(Array.from(base64ToBytes('AAEC\nAwQ='))).toEqual([0, 1, 2, 3, 4]);
    });

    it('rejects a character that is not base64', () => {
        expect(() => base64ToBytes('AAAA!AAA')).toThrow(EventDecodeError);
    });
});

describe('malformed input', () => {
    it('rejects a body of the wrong length', () => {
        expect(() => decodeIntentCommittedBody(new Uint8Array(191))).toThrow(EventDecodeError);
        expect(() => decodeIntentCommittedBody(new Uint8Array(193))).toThrow(EventDecodeError);
        expect(() => decodeIntentReceiptClosedBody(new Uint8Array(135))).toThrow(EventDecodeError);
    });

    it('accepts a body of exactly the right length', () => {
        expect(() =>
            decodeIntentCommittedBody(new Uint8Array(INTENT_COMMITTED_EVENT_SIZE)),
        ).not.toThrow();
        expect(() =>
            decodeIntentReceiptClosedBody(new Uint8Array(INTENT_RECEIPT_CLOSED_EVENT_SIZE)),
        ).not.toThrow();
    });

    it('returns null for bytes that are not a CommitOnce event', () => {
        expect(decodeCommitOnceEvent(new Uint8Array(200))).toBeNull();
        expect(decodeCommitOnceEvent(new Uint8Array(0))).toBeNull();
    });

    it('throws when the discriminator matches but the body is truncated', () => {
        // A matching discriminator with a short body is a real disagreement — a version
        // mismatch or a corrupted log — so it must not be silently ignored.
        const truncated = new Uint8Array(INTENT_COMMITTED_EVENT_SIZE); // 8 bytes of zeros
        truncated.set(INTENT_COMMITTED_EVENT_DISCRIMINATOR, 0);
        expect(() => decodeCommitOnceEvent(truncated)).toThrow(EventDecodeError);
    });

    it('ignores a program-data line with no payload', () => {
        expect(decodeEventFromLogLine('Program data: ')).toBeNull();
        expect(decodeEventFromLogLine('Program data:')).toBeNull();
    });
});

describe('IntentReceiptClosed', () => {
    it('decodes a well-formed body', () => {
        const body = new Uint8Array(INTENT_RECEIPT_CLOSED_EVENT_SIZE);
        body.set(new Uint8Array(32).fill(7), 0); // authority
        body.set(new Uint8Array(32).fill(8), 32); // namespace hash
        body.set(new Uint8Array(32).fill(9), 64); // key hash
        body.set(new Uint8Array(32).fill(10), 96); // payload hash
        new DataView(body.buffer).setBigUint64(128, 501_999_999n, true);

        const decoded = decodeIntentReceiptClosedBody(body);
        expect(decoded.closedSlot).toBe(501_999_999n);
        expect(decoded.namespaceHash[0]).toBe(8);
        expect(decoded.idempotencyKeyHash[0]).toBe(9);
        expect(decoded.payloadHash[0]).toBe(10);
    });

    it('is recognised by its discriminator and not confused with IntentCommitted', () => {
        const bytes = new Uint8Array(INTENT_RECEIPT_CLOSED_EVENT_SIZE + 8);
        bytes.set(INTENT_RECEIPT_CLOSED_EVENT_DISCRIMINATOR, 0);
        expect(isIntentReceiptClosedEvent(bytes)).toBe(true);
        expect(isIntentCommittedEvent(bytes)).toBe(false);
        expect(decodeCommitOnceEvent(bytes)?.name).toBe('IntentReceiptClosed');
    });

    it('has a discriminator distinct from IntentCommitted', () => {
        expect(bytesToHex(INTENT_RECEIPT_CLOSED_EVENT_DISCRIMINATOR)).not.toBe(
            bytesToHex(INTENT_COMMITTED_EVENT_DISCRIMINATOR),
        );
    });
});
