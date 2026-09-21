/**
 * The RPC-backed client.
 *
 * `prepareIntent` (in `instructions.ts`) is pure and needs no RPC — that is the property
 * that makes CommitOnce usable inside a wallet, a relay, or an offline signer. This module
 * adds the read side: what does the chain currently say about this intent?
 */

import {
    fetchEncodedAccount,
    type Address,
    type GetAccountInfoApi,
    type GetBlockTimeApi,
    type GetSlotApi,
    type Rpc,
} from '@solana/kit';
import {
    decodeIntentReceipt,
    isClosable,
    isPermanentReceipt,
    isSupportedVersion,
    type IntentReceiptAccount,
} from './accounts.js';
import { COMMIT_ONCE_PROGRAM_ADDRESS } from './constants.js';
import {
    idempotencyKeyHash,
    namespaceHash,
    toPayloadHash,
    type CanonicalIntent,
} from './hash.js';
import {
    createCloseReceiptInstruction,
    prepareIntent,
    type CloseReceiptInstructionArgs,
    type PreparedIntent,
    type PrepareIntentArgs,
} from './instructions.js';
import { deriveReceiptAddress } from './pda.js';

/**
 * The RPC surface this SDK uses.
 *
 * A full `createSolanaRpc(...)` client satisfies this. It is narrowed deliberately so the
 * requirement is explicit: reading a receipt is one `getAccountInfo`, and reading the
 * chain clock is a `getSlot` plus a `getBlockTime`.
 */
export type CommitOnceRpc = Rpc<GetAccountInfoApi & GetSlotApi & GetBlockTimeApi>;

/** A chain clock reading, used to decide whether a receipt has expired. */
export type CommitOnceClock = {
    readonly slot: bigint;
    readonly unixTimestamp: bigint;
};

/** Everything known about an existing receipt, independent of status. */
export type ReceiptSummary = {
    /** The receipt PDA. */
    readonly receipt: Address;
    /** The decoded onchain account. */
    readonly receiptData: IntentReceiptAccount;
    /** `true` when the receipt never expires and can never be closed. */
    readonly permanent: boolean;
    /**
     * Whether the receipt may be closed right now.
     *
     * `null` when no chain clock was supplied and it therefore cannot be determined.
     */
    readonly closable: boolean | null;
    /**
     * Whether the stored payload fingerprint matches the intent you supplied.
     *
     * `null` when no `intent` was supplied.
     *
     * * `true` — this is the same intent. A retry is a duplicate and will be blocked,
     *   which is the desired outcome.
     * * `false` — the key was already used for something else. This is an
     *   `IdempotencyConflict`, not a duplicate, and must not be silently retried.
     */
    readonly matchesIntent: boolean | null;
    /** `false` if the receipt was written by an incompatible program version. */
    readonly supportedVersion: boolean;
};

/** The result of asking the chain about an intent. */
export type IntentStatus =
    | {
          /** No receipt exists. The intent has not committed, and the key is free. */
          readonly status: 'unclaimed';
          readonly receipt: Address;
      }
    | ({ readonly status: 'committed' } & ReceiptSummary)
    | ({
          /** A receipt exists and has expired, so it may be closed to reclaim rent. */
          readonly status: 'expired';
      } & ReceiptSummary);

export type InspectIntentArgs = {
    readonly authority: Address;
    readonly namespace: string;
    readonly idempotencyKey: string;
    /**
     * Supply this to have the SDK report whether the existing receipt is for the *same*
     * intent or a conflicting one. Omit it if you only need existence and expiry.
     */
    readonly intent?: CanonicalIntent | Uint8Array;
    /** Supply a chain clock to have `closable` and the `committed`/`expired` split computed. */
    readonly clock?: CommitOnceClock;
    readonly programAddress?: Address;
};

export type CommitOnceClientConfig = {
    readonly rpc: CommitOnceRpc;
    /** Override the program address. Defaults to the canonical deployment. */
    readonly programAddress?: Address;
};

export type CommitOnceClient = {
    readonly programAddress: Address;
    readonly rpc: CommitOnceRpc;
    /** Pure: build the guard instruction for an intent. No RPC access. */
    prepare(args: Omit<PrepareIntentArgs, 'programAddress'>): Promise<PreparedIntent>;
    /** Derive the receipt PDA without touching the network. */
    deriveReceipt(args: {
        readonly authority: Address;
        readonly namespace: string;
        readonly idempotencyKey: string;
    }): Promise<readonly [Address, number]>;
    /** Fetch and decode a receipt by address. Returns `null` if it does not exist. */
    fetchReceipt(receipt: Address): Promise<IntentReceiptAccount | null>;
    /** Ask the chain what it knows about an intent. */
    inspect(args: InspectIntentArgs): Promise<IntentStatus>;
    /** Read the current chain clock. */
    fetchClock(): Promise<CommitOnceClock>;
    /** Build the cleanup instruction for an expired receipt. */
    closeReceiptInstruction(
        args: Omit<CloseReceiptInstructionArgs, 'programAddress'>,
    ): ReturnType<typeof createCloseReceiptInstruction>;
};

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

/**
 * Create a client bound to an RPC endpoint and program address.
 *
 * ```ts
 * const commitOnce = createCommitOnceClient({ rpc: createSolanaRpc(devnet('https://api.devnet.solana.com')) });
 * const guard = await commitOnce.prepare({ authority, namespace: 'payments:transfer', idempotencyKey: orderId, intent: { to, amount } });
 * // prepend guard.instruction to your transaction
 * ```
 */
export function createCommitOnceClient(config: CommitOnceClientConfig): CommitOnceClient {
    const programAddress = config.programAddress ?? COMMIT_ONCE_PROGRAM_ADDRESS;
    const { rpc } = config;

    async function fetchReceipt(receipt: Address): Promise<IntentReceiptAccount | null> {
        const account = await fetchEncodedAccount(rpc, receipt);
        if (!account.exists) {
            return null;
        }
        if (account.programAddress !== programAddress) {
            throw new Error(
                `CommitOnce: an account exists at ${receipt} but is owned by ` +
                    `${account.programAddress}, not by the CommitOnce program ${programAddress}. ` +
                    'Refusing to interpret it as a receipt.',
            );
        }
        return decodeIntentReceipt(account.data);
    }

    return {
        programAddress,
        rpc,

        prepare(args) {
            return prepareIntent({ ...args, programAddress });
        },

        async deriveReceipt(args) {
            const [nsHash, keyHash] = await Promise.all([
                namespaceHash(args.namespace),
                idempotencyKeyHash(args.idempotencyKey),
            ]);
            return deriveReceiptAddress({
                authority: args.authority,
                namespaceHash: nsHash,
                idempotencyKeyHash: keyHash,
                programAddress,
            });
        },

        fetchReceipt,

        async inspect(args) {
            const [nsHash, keyHash] = await Promise.all([
                namespaceHash(args.namespace),
                idempotencyKeyHash(args.idempotencyKey),
            ]);
            const [receipt] = await deriveReceiptAddress({
                authority: args.authority,
                namespaceHash: nsHash,
                idempotencyKeyHash: keyHash,
                programAddress,
            });

            const receiptData = await fetchReceipt(receipt);
            if (receiptData === null) {
                return { status: 'unclaimed', receipt };
            }

            const permanent = isPermanentReceipt(receiptData);
            const closable = args.clock === undefined ? null : isClosable(receiptData, args.clock);

            let matchesIntent: boolean | null = null;
            if (args.intent !== undefined) {
                const expected = await toPayloadHash(args.intent);
                matchesIntent = bytesEqual(expected, receiptData.payloadHash);
            }

            const summary: ReceiptSummary = {
                receipt,
                receiptData,
                permanent,
                closable,
                matchesIntent,
                supportedVersion: isSupportedVersion(receiptData),
            };

            return closable === true
                ? { status: 'expired', ...summary }
                : { status: 'committed', ...summary };
        },

        async fetchClock() {
            const slot = await rpc.getSlot({ commitment: 'confirmed' }).send();
            const blockTime = await rpc.getBlockTime(slot).send();
            if (blockTime === null) {
                throw new Error(
                    `CommitOnce: the cluster has no block time for slot ${slot}. Receipt expiry ` +
                        'requires both the slot deadline and the wall-clock deadline, so expiry ' +
                        'cannot be evaluated without it. Retry in a moment.',
                );
            }
            return { slot, unixTimestamp: blockTime };
        },

        closeReceiptInstruction(args) {
            return createCloseReceiptInstruction({ ...args, programAddress });
        },
    };
}
