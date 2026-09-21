/**
 * Instruction construction.
 *
 * The whole integration surface is one instruction that gets prepended to a transaction
 * the caller already builds:
 *
 * ```ts
 * const tx = pipe(
 *     createTransactionMessage({ version: 0 }),
 *     (m) => setTransactionMessageFeePayerSigner(authority, m),
 *     (m) => appendTransactionMessageInstructions(
 *         [guard.instruction, ...myBusinessInstructions],
 *         m,
 *     ),
 *     ...
 * );
 * ```
 *
 * Solana's atomicity does the rest: if the receipt already exists the guard fails, the
 * whole transaction is rolled back, and the business instructions never run. If a business
 * instruction fails, the receipt is rolled back with it, so there is no state in which a
 * receipt exists without its action having committed.
 */

import {
    AccountRole,
    getAddressEncoder,
    type AccountMeta,
    type Address,
    type Instruction,
} from '@solana/kit';
import {
    CLAIM_DISCRIMINATOR,
    CLOSE_RECEIPT_DISCRIMINATOR,
    COMMIT_ONCE_PROGRAM_ADDRESS,
    INSTRUCTIONS_SYSVAR_ADDRESS,
    MAX_RETENTION_SECONDS,
    MIN_RETENTION_SECONDS,
    PERMANENT_RETENTION,
    SYSTEM_PROGRAM_ADDRESS,
} from './constants.js';
import { idempotencyKeyHash, namespaceHash, toPayloadHash, type CanonicalIntent } from './hash.js';
import { deriveReceiptAddress } from './pda.js';

const addressEncoder = getAddressEncoder();

/** Default retention when the caller does not specify one: 24 hours. */
export const DEFAULT_RETENTION_SECONDS = 86_400n;

/**
 * Retention as accepted from callers.
 *
 * * `'permanent'` — the receipt never expires and can never be closed.
 * * `number` / `bigint` — seconds.
 * * `'30s'`, `'15m'`, `'24h'`, `'30d'` — a duration string.
 */
export type Retention = 'permanent' | number | bigint | `${number}s` | `${number}m` | `${number}h` | `${number}d`;

const UNIT_SECONDS: Record<string, bigint> = {
    s: 1n,
    m: 60n,
    h: 3_600n,
    d: 86_400n,
};

/**
 * Parse a {@link Retention} into seconds.
 *
 * Throws on anything malformed rather than coercing, because a silently wrong retention
 * would silently change the security window.
 */
export function parseRetention(retention: Retention | undefined): bigint {
    if (retention === undefined) {
        return DEFAULT_RETENTION_SECONDS;
    }
    if (retention === 'permanent') {
        return PERMANENT_RETENTION;
    }
    if (typeof retention === 'bigint') {
        return retention;
    }
    if (typeof retention === 'number') {
        if (!Number.isInteger(retention)) {
            throw new RangeError(
                `CommitOnce: retention must be a whole number of seconds, got ${retention}. ` +
                    "Use a string like '24h' for readability.",
            );
        }
        return BigInt(retention);
    }
    const match = /^(\d+)([smhd])$/.exec(retention);
    const digits = match?.[1];
    const unit = match?.[2];
    if (digits === undefined || unit === undefined) {
        throw new RangeError(
            `CommitOnce: could not parse retention ${JSON.stringify(retention)}. ` +
                "Expected 'permanent', a number of seconds, or a duration such as '30m', '24h', '30d'.",
        );
    }
    const multiplier = UNIT_SECONDS[unit];
    if (multiplier === undefined) {
        throw new RangeError(`CommitOnce: unknown retention unit ${JSON.stringify(unit)}`);
    }
    return BigInt(digits) * multiplier;
}

/**
 * Reject retention values the program would reject.
 *
 * This is a convenience, not a security boundary: the program enforces the same range
 * onchain, so a caller who bypasses this still cannot create a receipt with a bogus
 * window.
 */
export function assertValidRetention(retentionSeconds: bigint): void {
    if (retentionSeconds === PERMANENT_RETENTION) {
        return;
    }
    if (retentionSeconds < MIN_RETENTION_SECONDS || retentionSeconds > MAX_RETENTION_SECONDS) {
        throw new RangeError(
            `CommitOnce: retention of ${retentionSeconds}s is out of range. Use 0 (permanent) ` +
                `or between ${MIN_RETENTION_SECONDS}s (1 hour) and ${MAX_RETENTION_SECONDS}s (365 days).`,
        );
    }
}

export type PrepareIntentArgs = {
    /** The intent authority. Must be a signer on the transaction. */
    readonly authority: Address;
    /**
     * Application or feature scope, e.g. `'payments:transfer'`.
     *
     * Namespaces exist so two applications can use the same textual key without
     * colliding. Pick a stable, unique prefix; changing it changes the receipt address.
     */
    readonly namespace: string;
    /** The caller's idempotency key, e.g. an order id. Must be stable across retries. */
    readonly idempotencyKey: string;
    /**
     * What this intent *is*, for conflict detection.
     *
     * A plain object/array/primitive is canonically encoded and hashed. A 32-byte
     * `Uint8Array` is used as a precomputed fingerprint directly.
     *
     * Must contain only semantic content. Never include a blockhash, signature, priority
     * fee, compute budget or retry counter — those change on every rebuild and would make
     * a retry look like a different intent.
     */
    readonly intent: CanonicalIntent | Uint8Array;
    /** Defaults to 24 hours. See {@link Retention}. */
    readonly retention?: Retention;
    /** Where the rent deposit goes after expiry. Defaults to the authority. */
    readonly refundDestination?: Address;
    /** Override the program address. Defaults to the canonical deployment. */
    readonly programAddress?: Address;
};

export type PreparedIntent = {
    /** Prepend this to your business instructions, in the same transaction. */
    readonly instruction: Instruction;
    /** The receipt PDA this intent claims. */
    readonly receipt: Address;
    /** Canonical bump for the receipt PDA. */
    readonly receiptBump: number;
    readonly namespaceHash: Uint8Array;
    readonly idempotencyKeyHash: Uint8Array;
    readonly payloadHash: Uint8Array;
    readonly retentionSeconds: bigint;
    readonly refundDestination: Address;
    readonly programAddress: Address;
};

/** Serialized length of the `claim` instruction data. */
export const CLAIM_DATA_LENGTH = 8 + 32 + 32 + 32 + 8 + 32;

export type EncodeClaimDataArgs = {
    readonly namespaceHash: Uint8Array;
    readonly idempotencyKeyHash: Uint8Array;
    readonly payloadHash: Uint8Array;
    readonly retentionSeconds: bigint;
    readonly refundDestination: Address;
};

/**
 * Borsh-encode the `claim` instruction data.
 *
 * Written by hand rather than generated, so that this package stays dependency-free and
 * the exact byte layout is auditable in one place:
 *
 * ```text
 * offset  size  field
 * 0       8     Anchor discriminator, sha256("global:claim")[0..8]
 * 8       32    namespace_hash
 * 40      32    idempotency_key_hash
 * 72      32    payload_hash
 * 104     8     retention_seconds (u64, little-endian)
 * 112     32    refund_destination
 * total   144
 * ```
 */
export function encodeClaimData(args: EncodeClaimDataArgs): Uint8Array {
    const data = new Uint8Array(CLAIM_DATA_LENGTH);
    data.set(CLAIM_DISCRIMINATOR, 0);
    data.set(args.namespaceHash, 8);
    data.set(args.idempotencyKeyHash, 40);
    data.set(args.payloadHash, 72);
    new DataView(data.buffer, data.byteOffset, data.byteLength).setBigUint64(
        104,
        args.retentionSeconds,
        true,
    );
    data.set(addressEncoder.encode(args.refundDestination), 112);
    return data;
}

/**
 * Build the guard instruction for an intent, without any RPC access.
 *
 * This is the primary integration point. It is pure: everything it needs is derived
 * locally, which is the property that distinguishes CommitOnce from guard primitives that
 * require a proof or indexer round trip before you can build the instruction.
 */
export async function prepareIntent(args: PrepareIntentArgs): Promise<PreparedIntent> {
    const programAddress = args.programAddress ?? COMMIT_ONCE_PROGRAM_ADDRESS;
    const retentionSeconds = parseRetention(args.retention);
    assertValidRetention(retentionSeconds);

    const [nsHash, keyHash, payloadHash] = await Promise.all([
        namespaceHash(args.namespace),
        idempotencyKeyHash(args.idempotencyKey),
        toPayloadHash(args.intent),
    ]);

    const refundDestination = args.refundDestination ?? args.authority;
    const [receipt, receiptBump] = await deriveReceiptAddress({
        authority: args.authority,
        namespaceHash: nsHash,
        idempotencyKeyHash: keyHash,
        programAddress,
    });

    // The program rejects this too, but catching it here gives a useful message instead of
    // a bare custom error code.
    if (refundDestination === receipt) {
        throw new Error(
            'CommitOnce: refundDestination must not be the receipt PDA. The deposit would be ' +
                'paid straight back into the account being closed.',
        );
    }

    const instruction: Instruction = {
        programAddress,
        accounts: [
            { address: args.authority, role: AccountRole.WRITABLE_SIGNER },
            { address: receipt, role: AccountRole.WRITABLE },
            { address: INSTRUCTIONS_SYSVAR_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ] satisfies AccountMeta[],
        data: encodeClaimData({
            namespaceHash: nsHash,
            idempotencyKeyHash: keyHash,
            payloadHash,
            retentionSeconds,
            refundDestination,
        }),
    };

    return {
        instruction,
        receipt,
        receiptBump,
        namespaceHash: nsHash,
        idempotencyKeyHash: keyHash,
        payloadHash,
        retentionSeconds,
        refundDestination,
        programAddress,
    };
}

export type CloseReceiptInstructionArgs = {
    /** The receipt PDA to close. It must have expired. */
    readonly receipt: Address;
    /**
     * Must equal the `refundDestination` recorded when the receipt was created.
     *
     * The program enforces this, so the deposit cannot be redirected by whoever happens to
     * submit the cleanup transaction. That means cleanup is permissionless: anybody can
     * pay the fee, and the deposit still goes to the configured destination.
     */
    readonly refundDestination: Address;
    readonly programAddress?: Address;
};

/**
 * Build the `close_receipt` instruction.
 *
 * Anyone may submit this once a receipt has expired, and the rent deposit is returned to
 * the destination recorded at claim time. That is deliberate: cleanup does not require the
 * authority to be online, and cannot be used to steal the deposit.
 */
export function createCloseReceiptInstruction(args: CloseReceiptInstructionArgs): Instruction {
    return {
        programAddress: args.programAddress ?? COMMIT_ONCE_PROGRAM_ADDRESS,
        accounts: [
            { address: args.receipt, role: AccountRole.WRITABLE },
            { address: args.refundDestination, role: AccountRole.WRITABLE },
        ] satisfies AccountMeta[],
        data: CLOSE_RECEIPT_DISCRIMINATOR,
    };
}
