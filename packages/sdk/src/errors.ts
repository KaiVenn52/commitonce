/**
 * Error classification.
 *
 * The program's custom error codes are the machine-readable part of its contract, so they
 * are enumerated here rather than left as magic numbers in caller code. `classifyError`
 * turns whatever an RPC client threw into a stable, typed discriminant.
 *
 * Codes are Anchor's custom range starting at 6000, in enum declaration order. They match
 * `programs/commit-once/src/error.rs`; `test/vectors.test.ts` asserts this list against
 * the generated IDL so a reordering of the Rust enum is caught by CI rather than by a
 * caller misreading an error.
 */

/** Anchor numbers custom program errors from 6000 upwards. */
export const COMMIT_ONCE_ERROR_CODES = {
    /** A receipt for this `(authority, namespace, key)` already exists with a matching payload. */
    AlreadyCommitted: 6000,
    /** A receipt exists, but for a *different* payload fingerprint. */
    IdempotencyConflict: 6001,
    /** The transaction is a durable-nonce transaction and retention was finite. */
    DurableNonceUnsupported: 6002,
    /** Retention was neither 0 nor within `[MIN_RETENTION_SECONDS, MAX_RETENTION_SECONDS]`. */
    InvalidRetention: 6003,
    /** `refundDestination` was the default pubkey or the receipt PDA itself. */
    InvalidRefundDestination: 6004,
    /** An account exists at the receipt PDA but is not owned by the CommitOnce program. */
    InvalidReceiptOwner: 6005,
    /** The receipt's stored hashes disagree with the instruction's. */
    InvalidReceiptData: 6006,
    /** The receipt's stored authority disagrees with the signer. */
    InvalidReceiptAuthority: 6007,
    /** The receipt was written by a different (future) program version. */
    UnsupportedReceiptVersion: 6008,
    /** `close_receipt` was called before both deadlines passed. */
    ReceiptNotExpired: 6009,
    /** `close_receipt` was called on a permanent receipt. */
    ReceiptIsPermanent: 6010,
    /** The transaction had more instructions than the durable-nonce scan reads. */
    InstructionScanInconclusive: 6011,
} as const;

export type CommitOnceErrorName = keyof typeof COMMIT_ONCE_ERROR_CODES;

/** Stable, human-readable description of each error, for CLI and UI output. */
export const COMMIT_ONCE_ERROR_MESSAGES: Record<CommitOnceErrorName, string> = {
    AlreadyCommitted:
        'This intent has already committed. The transaction was aborted so the guarded ' +
        'instructions did not run a second time.',
    IdempotencyConflict:
        'This idempotency key was already used with a different payload fingerprint. ' +
        'Either reuse the original payload, or use a new key.',
    DurableNonceUnsupported:
        'The transaction carries a durable nonce. Durable-nonce transactions never expire, ' +
        'so a finite retention window could be cleaned up while an old signed duplicate is ' +
        'still executable. Use retention 0 (permanent) for nonce transactions.',
    InvalidRetention:
        'Retention must be 0 (permanent), or between one hour and 365 days.',
    InvalidRefundDestination:
        'The rent refund destination must not be the default pubkey or the receipt PDA.',
    InvalidReceiptOwner:
        'An account exists at the receipt address but is not owned by the CommitOnce program.',
    InvalidReceiptData:
        'The receipt at this address does not match the requested namespace and key.',
    InvalidReceiptAuthority:
        'The receipt at this address belongs to a different authority.',
    UnsupportedReceiptVersion:
        'The receipt was written by an incompatible program version. Upgrade the SDK.',
    ReceiptNotExpired:
        'The receipt has not expired yet. Both the slot deadline and the wall-clock ' +
        'deadline must pass before it can be closed.',
    ReceiptIsPermanent:
        'This receipt is permanent (retention 0) and can never be closed.',
    InstructionScanInconclusive:
        'The transaction carries more instructions than the durable-nonce scan reads, so ' +
        'CommitOnce could not prove it is not a durable-nonce transaction and refused ' +
        'rather than assuming. Use retention 0 (permanent), which skips the scan, or ' +
        'split the transaction.',
};

/** The discriminant returned by {@link classifyError}. */
export type CommitOnceErrorKind =
    | { readonly kind: 'commit-once'; readonly name: CommitOnceErrorName; readonly code: number; readonly message: string }
    | { readonly kind: 'other'; readonly code: number | null };

function findCustomCode(error: unknown): number | null {
    // Kit errors expose a `context`; RPC errors carry a JSON `data` payload. Rather than
    // depend on either shape, walk the object graph for the two forms the runtime uses:
    //   { InstructionError: [index, { Custom: 6000 }] }
    //   { err: { InstructionError: ... } }
    const seen = new Set<unknown>();
    const stack: unknown[] = [error];

    while (stack.length > 0) {
        const current = stack.pop();
        if (current === null || current === undefined || seen.has(current)) {
            continue;
        }
        seen.add(current);

        if (typeof current === 'number' && Number.isInteger(current) && current >= 6000 && current < 6100) {
            return current;
        }

        if (typeof current === 'string') {
            // Errors serialized into a message string, e.g. 'custom program error: 0x1770'.
            const hex = /custom program error: 0x([0-9a-f]+)/i.exec(current);
            if (hex?.[1]) {
                const code = Number.parseInt(hex[1], 16);
                if (Number.isInteger(code)) {
                    return code;
                }
            }
            const dec = /custom program error: (\d+)/i.exec(current);
            if (dec?.[1]) {
                return Number.parseInt(dec[1], 10);
            }
            continue;
        }

        if (typeof current === 'object') {
            // `Object.values` on an Error returns `[]`, because `message` and `stack` are
            // non-enumerable. RPC clients routinely surface the program error only inside
            // the message string, so it has to be read explicitly.
            if (current instanceof Error) {
                stack.push(current.message);
            }
            for (const value of Object.values(current as Record<string, unknown>)) {
                stack.push(value);
            }
        }
    }
    return null;
}

/**
 * Classify an error thrown by an RPC client into a CommitOnce error, or `{ kind: 'other' }`.
 *
 * Never throws: an unrecognised error is reported as `other` rather than being swallowed
 * or guessed at.
 */
export function classifyError(error: unknown): CommitOnceErrorKind {
    const code = findCustomCode(error);
    if (code === null) {
        return { kind: 'other', code: null };
    }
    const name = (Object.keys(COMMIT_ONCE_ERROR_CODES) as CommitOnceErrorName[]).find(
        (candidate) => COMMIT_ONCE_ERROR_CODES[candidate] === code,
    );
    if (name === undefined) {
        return { kind: 'other', code };
    }
    return { kind: 'commit-once', name, code, message: COMMIT_ONCE_ERROR_MESSAGES[name] };
}

/**
 * `true` when the error means "this intent already committed, and the guarded instructions
 * were therefore skipped". This is the expected, non-exceptional outcome of a retry.
 */
export function isAlreadyCommitted(error: unknown): boolean {
    const classified = classifyError(error);
    return classified.kind === 'commit-once' && classified.name === 'AlreadyCommitted';
}

/** `true` when the key was reused with a different payload fingerprint. */
export function isIdempotencyConflict(error: unknown): boolean {
    const classified = classifyError(error);
    return classified.kind === 'commit-once' && classified.name === 'IdempotencyConflict';
}
