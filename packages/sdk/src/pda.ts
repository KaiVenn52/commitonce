/**
 * Receipt PDA derivation.
 *
 * The receipt address is a function of the authority, the namespace and the idempotency
 * key — and of nothing else. That is what makes the key space authority-scoped: a third
 * party who learns your namespace and key derives a *different* address and therefore
 * cannot consume, block or grief your intent.
 */

import { getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';
import { COMMIT_ONCE_PROGRAM_ADDRESS, RECEIPT_SEED } from './constants.js';

const addressEncoder = getAddressEncoder();

export type DeriveReceiptAddressArgs = {
    /** The intent authority. Bound into the PDA seeds, so keys are per-authority. */
    readonly authority: Address;
    /** `sha256("commitonce/namespace/v1" || namespace)`. */
    readonly namespaceHash: Uint8Array;
    /** `sha256("commitonce/key/v1" || idempotencyKey)`. */
    readonly idempotencyKeyHash: Uint8Array;
    /** Override the program address. Defaults to the canonical deployment. */
    readonly programAddress?: Address;
};

function assertHash32(label: string, value: unknown): asserts value is Uint8Array {
    if (!(value instanceof Uint8Array) || value.length !== 32) {
        throw new RangeError(
            `CommitOnce: ${label} must be a 32-byte Uint8Array. Use namespaceHash() or ` +
                'idempotencyKeyHash() to derive it.',
        );
    }
}

/**
 * Derive the receipt address for an intent.
 *
 * Returns `[address, bump]`. The bump is the canonical one found by the runtime; it is
 * what `prepareIntent` writes into the instruction, and the program re-derives it via its
 * `seeds`/`bump` constraint, so a wrong bump cannot be used to reach a different account.
 */
export async function deriveReceiptAddress(
    args: DeriveReceiptAddressArgs,
): Promise<readonly [Address, number]> {
    assertHash32('namespaceHash', args.namespaceHash);
    assertHash32('idempotencyKeyHash', args.idempotencyKeyHash);
    return getProgramDerivedAddress({
        programAddress: args.programAddress ?? COMMIT_ONCE_PROGRAM_ADDRESS,
        seeds: [
            RECEIPT_SEED,
            addressEncoder.encode(args.authority),
            args.namespaceHash,
            args.idempotencyKeyHash,
        ],
    });
}
