/**
 * # @commitonce/solana
 *
 * **Idempotency keys for Solana.** An onchain idempotency layer for Solana actions:
 * retry without executing twice.
 *
 * ## The problem
 *
 * Solana deduplicates an *identical signed transaction*, because the network keys its
 * duplicate detection on the transaction's message hash. A **logical user intent** is not
 * the same thing as a transaction.
 *
 * When your application hits an ambiguous timeout, it rebuilds: fresh blockhash, maybe a
 * different priority fee, a different route, a re-signed transaction. The bytes differ, so
 * the message hash differs, so the network treats it as a brand new transaction. Both can
 * land. Solana's own production-readiness guidance says so directly — *"a rebuilt
 * transaction has a new signature, so preserve application-level idempotency before
 * sending it"* — and leaves the idempotency layer to you.
 *
 * ## The guarantee
 *
 * Prepend one instruction to the transaction you already build:
 *
 * ```ts
 * const guard = await commitOnce.prepare({
 *     authority,
 *     namespace: 'payments:transfer',
 *     idempotencyKey: orderId,
 *     intent: { to, amount },
 * });
 *
 * const message = pipe(
 *     createTransactionMessage({ version: 0 }),
 *     (m) => setTransactionMessageFeePayerSigner(authority, m),
 *     (m) => appendTransactionMessageInstructions([guard.instruction, transferInstruction], m),
 *     (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
 * );
 * ```
 *
 * For one `(authority, namespace, idempotency key)` tuple, **no more than one guarded
 * transaction may successfully commit during the receipt retention period.**
 *
 * Solana's atomicity does the work: if the receipt already exists the guard fails, the
 * whole transaction is rolled back, and your business instructions never run. If a
 * business instruction fails, the receipt is rolled back with it — so there is no state in
 * which a receipt exists without its action having committed.
 *
 * This is **at-most-once successful execution within a retention window**, not
 * mathematically universal exactly-once. Combined with ordinary retry-until-success it
 * gives you exactly-once-style application semantics, and it is honest about the window.
 *
 * ## What is deliberately different
 *
 * * **Authority-scoped keys.** The authority is part of the receipt's PDA derivation, so
 *   nobody who learns your key can consume it first and block you. The protocol enforces
 *   this rather than relying on you to hash your own pubkey into the key.
 * * **No RPC, prover or indexer needed to build the instruction.** `prepare()` is pure.
 * * **Namespaces.** Two applications can use the same textual key without colliding.
 * * **An explicit retention window with a full rent refund.** Expired receipts can be
 *   cleaned up by anyone, and the deposit always returns to the destination recorded at
 *   claim time — so cleanup is permissionless and cannot be used to steal.
 * * **A documented durable-nonce policy.** Durable-nonce transactions never expire, so a
 *   finite window could be cleaned up while an old signed duplicate is still executable.
 *   Those transactions are rejected unless retention is permanent.
 *
 * @packageDocumentation
 */

export {
    ACCOUNT_STORAGE_OVERHEAD,
    CLAIM_DISCRIMINATOR,
    CLOSE_RECEIPT_DISCRIMINATOR,
    COMMIT_ONCE_PROGRAM_ADDRESS,
    IDEMPOTENCY_KEY_DOMAIN,
    INSTRUCTIONS_SYSVAR_ADDRESS,
    INTENT_COMMITTED_EVENT_DISCRIMINATOR,
    INTENT_COMMITTED_EVENT_SIZE,
    INTENT_RECEIPT_CLOSED_EVENT_DISCRIMINATOR,
    INTENT_RECEIPT_CLOSED_EVENT_SIZE,
    INTENT_RECEIPT_DISCRIMINATOR,
    MAINNET_LAMPORTS_PER_BYTE,
    MAX_RETENTION_SECONDS,
    MIN_RETENTION_SECONDS,
    NAMESPACE_DOMAIN,
    PERMANENT_RETENTION,
    PROGRAM_DATA_LOG_PREFIX,
    RECEIPT_ACCOUNT_SIZE,
    RECEIPT_RENT_LAMPORTS,
    RECEIPT_SEED,
    RECEIPT_VERSION,
    SLOTS_PER_SECOND,
    SYSTEM_PROGRAM_ADDRESS,
} from './constants.js';

export {
    bytesToHex,
    encodeIntent,
    getSubtleCrypto,
    hashIntent,
    hexToBytes,
    idempotencyKeyHash,
    namespaceHash,
    sha256,
    toPayloadHash,
    type ByteSequence,
    type CanonicalIntent,
} from './hash.js';

export { deriveReceiptAddress, type DeriveReceiptAddressArgs } from './pda.js';

export {
    assertValidRetention,
    CLAIM_DATA_LENGTH,
    createCloseReceiptInstruction,
    DEFAULT_RETENTION_SECONDS,
    encodeClaimData,
    parseRetention,
    prepareIntent,
    type CloseReceiptInstructionArgs,
    type EncodeClaimDataArgs,
    type PrepareIntentArgs,
    type PreparedIntent,
    type Retention,
} from './instructions.js';

export {
    decodeIntentReceipt,
    isClosable,
    isIntentReceipt,
    isPermanentReceipt,
    isSupportedVersion,
    ReceiptDecodeError,
    type IntentReceiptAccount,
} from './accounts.js';

export {
    classifyError,
    COMMIT_ONCE_ERROR_CODES,
    COMMIT_ONCE_ERROR_MESSAGES,
    isAlreadyCommitted,
    isIdempotencyConflict,
    type CommitOnceErrorKind,
    type CommitOnceErrorName,
} from './errors.js';

export {
    base64ToBytes,
    decodeCommitOnceEvent,
    decodeEventFromLogLine,
    decodeEventsFromLogs,
    decodeIntentCommittedBody,
    decodeIntentReceiptClosedBody,
    EventDecodeError,
    isIntentCommittedEvent,
    isIntentReceiptClosedEvent,
    type CommitOnceEvent,
    type IntentCommittedEvent,
    type IntentReceiptClosedEvent,
} from './events.js';

export {
    createCommitOnceClient,
    type CommitOnceClient,
    type CommitOnceClientConfig,
    type CommitOnceClock,
    type CommitOnceRpc,
    type InspectIntentArgs,
    type IntentStatus,
    type ReceiptSummary,
} from './client.js';
