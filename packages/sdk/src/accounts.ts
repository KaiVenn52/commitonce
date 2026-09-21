/**
 * Onchain receipt decoding.
 *
 * The layout is fixed-size and explicitly versioned, so it can be decoded without an IDL
 * round trip and without a generated client. That matters for indexers, dashboards and
 * the demo: reading a receipt is a single `getAccountInfo`.
 *
 * ```text
 * offset  size  field
 * 0       8     Anchor account discriminator, sha256("account:IntentReceipt")[0..8]
 * 8       1     version
 * 9       1     bump
 * 10      32    authority
 * 42      32    namespace_hash
 * 74      32    idempotency_key_hash
 * 106     32    payload_hash
 * 138     32    refund_destination
 * 170     8     created_slot            (u64 LE)
 * 178     8     expires_at_slot         (u64 LE, 0 = permanent)
 * 186     8     created_unix_ts         (i64 LE)
 * 194     8     expires_at_unix_ts      (i64 LE, 0 = permanent)
 * total   202
 * ```
 */

import { getAddressDecoder, type Address } from '@solana/kit';
import { INTENT_RECEIPT_DISCRIMINATOR, RECEIPT_ACCOUNT_SIZE, RECEIPT_VERSION } from './constants.js';

const addressDecoder = getAddressDecoder();

/** A decoded `IntentReceipt` account. */
export type IntentReceiptAccount = {
    readonly version: number;
    readonly bump: number;
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

/** Raised when bytes at a receipt address are not a decodable `IntentReceipt`. */
export class ReceiptDecodeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ReceiptDecodeError';
    }
}

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

/** `true` if `data` starts with the `IntentReceipt` account discriminator. */
export function isIntentReceipt(data: Uint8Array): boolean {
    return (
        data.length >= 8 &&
        bytesEqual(data.subarray(0, 8), INTENT_RECEIPT_DISCRIMINATOR)
    );
}

/**
 * Decode an `IntentReceipt` from raw account data.
 *
 * Throws {@link ReceiptDecodeError} rather than returning partial data, so a caller can
 * never act on a misparsed receipt.
 */
export function decodeIntentReceipt(data: Uint8Array): IntentReceiptAccount {
    if (!isIntentReceipt(data)) {
        throw new ReceiptDecodeError(
            'Account data does not begin with the IntentReceipt discriminator. It is either ' +
                'not a CommitOnce receipt or belongs to an incompatible program version.',
        );
    }
    if (data.length !== RECEIPT_ACCOUNT_SIZE) {
        throw new ReceiptDecodeError(
            `IntentReceipt must be ${RECEIPT_ACCOUNT_SIZE} bytes, got ${data.length}.`,
        );
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    return {
        version: data[8] as number,
        bump: data[9] as number,
        authority: addressDecoder.decode(data.subarray(10, 42)),
        namespaceHash: data.slice(42, 74),
        idempotencyKeyHash: data.slice(74, 106),
        payloadHash: data.slice(106, 138),
        refundDestination: addressDecoder.decode(data.subarray(138, 170)),
        createdSlot: view.getBigUint64(170, true),
        expiresAtSlot: view.getBigUint64(178, true),
        createdUnixTimestamp: view.getBigInt64(186, true),
        expiresAtUnixTimestamp: view.getBigInt64(194, true),
    };
}

/**
 * `true` when the receipt has no expiry.
 *
 * A permanent receipt can never be closed, which is why it is the only kind that may be
 * combined with a durable-nonce transaction: there is no cleanup that could reopen the
 * duplicate window.
 */
export function isPermanentReceipt(receipt: IntentReceiptAccount): boolean {
    return receipt.expiresAtSlot === 0n;
}

/** `true` when the receipt was written by a version this SDK understands. */
export function isSupportedVersion(receipt: IntentReceiptAccount): boolean {
    return receipt.version === RECEIPT_VERSION;
}

/**
 * Whether a receipt may be closed, given the current chain time.
 *
 * Mirrors the program exactly: **both** the monotonic slot deadline and the wall-clock
 * deadline must have passed. The slot deadline is manipulation-proof but assumes a slot
 * rate; the wall-clock deadline keeps the advertised retention honest if slots run fast.
 * Requiring both means a change in slot timing can only ever delay cleanup, never
 * accelerate it into a still-valid duplicate window.
 */
export function isClosable(
    receipt: IntentReceiptAccount,
    clock: { readonly slot: bigint; readonly unixTimestamp: bigint },
): boolean {
    if (isPermanentReceipt(receipt)) {
        return false;
    }
    return clock.slot >= receipt.expiresAtSlot && clock.unixTimestamp >= receipt.expiresAtUnixTimestamp;
}
