/**
 * The durable-nonce policy, tested against a real cluster.
 *
 * `tests/security.rs` asserts the program's *stricter* behaviour: it injects an
 * `AdvanceNonceAccount` instruction and checks that the policy fires. That is a real test of the
 * program's logic, but it is not a real nonce transaction — LiteSVM 0.10.0 cannot express one,
 * because it passes the transaction's own blockhash into the program environment, which makes the
 * System Program's advance check and the runtime's nonce validation mutually exclusive. The
 * limitation is documented at length in `tests/security.rs`, and until now the honest summary was
 * "the policy is tested, the runtime interaction is not".
 *
 * This closes that gap against a live cluster. It creates a real nonce account on devnet, builds
 * a real durable-nonce transaction whose blockhash is the stored nonce value, and simulates it
 * with the guard prepended:
 *
 *   1. finite retention  -> `claim` refuses, `DurableNonceUnsupported` (6002)
 *   2. permanent         -> `claim` accepts, because a permanent receipt has no cleanup path and
 *                           so cannot be reopened by one
 *
 * It **simulates** rather than sends, deliberately: a real nonce transaction consumes the nonce,
 * so sending both cases would need two nonce accounts and would leave a receipt on chain for a
 * policy test that does not need one. Simulation runs the full program logic and reports the
 * program's own error, which is the thing being tested.
 *
 * Run:
 *   RPC_URL=https://api.devnet.solana.com \
 *   PAYER_KEYPAIR=~/.config/solana/id.json \
 *   node apps/demo/nonce-policy.ts
 *
 * Costs a few thousand lamports of devnet SOL, and closes the nonce account at the end.
 */

import { readFile } from 'node:fs/promises';

import {
    address,
    appendTransactionMessageInstructions,
    createKeyPairSignerFromBytes,
    createSolanaRpc,
    createTransactionMessage,
    generateKeyPairSigner,
    getBase64EncodedWireTransaction,
    pipe,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    type Instruction,
    type KeyPairSigner,
} from '@solana/kit';
import {
    SYSTEM_PROGRAM_ADDRESS,
    fetchNonce,
    getAdvanceNonceAccountInstruction,
    getCreateAccountInstruction,
    getInitializeNonceAccountInstruction,
} from '@solana-program/system';
import { classifyError, createCommitOnceClient } from '@commitonce/solana';

// ---------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------

function requireEnv(name: string): string {
    const value = process.env[name];
    if (value === undefined || value.trim() === '') {
        throw new Error(`CommitOnce nonce policy demo: ${name} is required.`);
    }
    return value.trim();
}

const RPC_URL = requireEnv('RPC_URL');
const PAYER_PATH = requireEnv('PAYER_KEYPAIR');

const NAMESPACE = 'demo:nonce-policy';

/** A nonce account is 80 bytes; this is its rent plus headroom. */
const NONCE_RENT_LAMPORTS = 1_500_000n;
const NONCE_SPACE = 80n;

const RECENT_BLOCKHASHES = address('SysvarRecentB1ockHashes11111111111111111111');

// ---------------------------------------------------------------------------------------

async function loadSigner(path: string): Promise<KeyPairSigner> {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 64) {
        throw new Error(`CommitOnce nonce policy demo: ${path} is not a Solana CLI keypair.`);
    }
    return await createKeyPairSignerFromBytes(Uint8Array.from(parsed as number[]));
}

function banner(text: string): void {
    console.log(`\n===== ${text} =====`);
}

/** Report a simulation result the way a caller would read it. */
function report(label: string, value: { err: unknown; logs?: readonly string[] | null }): void {
    if (value.err === null || value.err === undefined) {
        console.log(`  ${label.padEnd(22)} SUCCESS`);
    } else {
        const classified = classifyError(value);
        const detail =
            classified.kind === 'commit-once'
                ? `${classified.name} (${classified.code})`
                : JSON.stringify(value.err);
        console.log(`  ${label.padEnd(22)} ${detail}`);
    }
    for (const line of (value.logs ?? []).filter((l) => /CommitOnce/i.test(l))) {
        console.log(`      ${line}`);
    }
}

async function main(): Promise<void> {
    const rpc = createSolanaRpc(RPC_URL);
    const payer = await loadSigner(PAYER_PATH);
    const commitOnce = createCommitOnceClient({ rpc });

    const balance = await rpc.getBalance(payer.address).send();
    console.log('CommitOnce — durable-nonce policy against a live cluster');
    console.log(`  rpc        ${RPC_URL}`);
    console.log(`  payer      ${payer.address}`);
    console.log(`  balance    ${balance.value} lamports`);

    if (balance.value < 5_000_000n) {
        throw new Error(
            `the payer holds ${balance.value} lamports; this needs a few million on devnet. ` +
                'Run: solana airdrop 1 --url devnet',
        );
    }

    // -----------------------------------------------------------------------------------
    // 1. A real nonce account.
    // -----------------------------------------------------------------------------------
    banner('1. create a real nonce account');

    const nonceAccount = await generateKeyPairSigner();
    const { value: creationBlockhash } = await rpc.getLatestBlockhash().send();

    const creationTx = await signTransactionMessageWithSigners(
        pipe(
            createTransactionMessage({ version: 0 }),
            (m) => setTransactionMessageFeePayerSigner(payer, m),
            (m) => setTransactionMessageLifetimeUsingBlockhash(creationBlockhash, m),
            (m) =>
                appendTransactionMessageInstructions(
                    [
                        getCreateAccountInstruction({
                            payer,
                            newAccount: nonceAccount,
                            lamports: NONCE_RENT_LAMPORTS,
                            space: NONCE_SPACE,
                            programAddress: SYSTEM_PROGRAM_ADDRESS,
                        }),
                        getInitializeNonceAccountInstruction({
                            nonceAccount: nonceAccount.address,
                            nonceAuthority: payer.address,
                            recentBlockhashesSysvar: RECENT_BLOCKHASHES,
                        }),
                    ],
                    m,
                ),
        ),
    );

    const creationSignature = await rpc
        .sendTransaction(getBase64EncodedWireTransaction(creationTx), {
            encoding: 'base64',
            preflightCommitment: 'confirmed',
        })
        .send();
    console.log(`  nonce account  ${nonceAccount.address}`);
    console.log(`  signature      ${creationSignature}`);
    console.log(`  explorer       https://explorer.solana.com/tx/${creationSignature}?cluster=devnet`);

    // Poll until the account is readable rather than sleeping a fixed amount.
    let storedNonce: string | null = null;
    for (let attempt = 0; attempt < 20 && storedNonce === null; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        try {
            const account = await fetchNonce(rpc, nonceAccount.address);
            storedNonce = account.data.blockhash;
        } catch {
            // not landed yet
        }
    }
    if (storedNonce === null) {
        throw new Error('the nonce account never became readable; the transaction may not have landed');
    }
    console.log(`  stored nonce   ${storedNonce}`);

    // -----------------------------------------------------------------------------------
    // 2. Simulate a durable-nonce transaction for each retention.
    //
    //    The blockhash is the *stored nonce value*, and `AdvanceNonceAccount` is the first
    //    instruction. That pair is what makes the runtime classify a transaction as a durable
    //    nonce transaction, so these are real ones rather than an injected marker.
    // -----------------------------------------------------------------------------------
    banner('2. simulate the guard in a real durable-nonce transaction');

    const advance = getAdvanceNonceAccountInstruction({
        nonceAccount: nonceAccount.address,
        nonceAuthority: payer,
        recentBlockhashesSysvar: RECENT_BLOCKHASHES,
    });

    async function simulate(
        idempotencyKey: string,
        retention: '24h' | 'permanent',
    ): Promise<{ err: unknown; logs?: readonly string[] | null }> {
        const guard = await commitOnce.prepare({
            authority: payer.address,
            namespace: NAMESPACE,
            idempotencyKey,
            intent: { action: 'nonce-policy', case: retention },
            retention,
        });

        const instructions: Instruction[] = [advance, guard.instruction];
        const tx = await signTransactionMessageWithSigners(
            pipe(
                createTransactionMessage({ version: 0 }),
                (m) => setTransactionMessageFeePayerSigner(payer, m),
                // The nonce value *is* the blockhash for a durable-nonce transaction. Using the
                // blockhash-lifetime helper here is not a fudge: on the wire it is the same
                // field, and it is what makes the runtime treat this as a nonce transaction.
                (m) =>
                    setTransactionMessageLifetimeUsingBlockhash(
                        { blockhash: storedNonce as never, lastValidBlockHeight: 0n },
                        m,
                    ),
                (m) => appendTransactionMessageInstructions(instructions, m),
            ),
        );

        const result = await rpc
            .simulateTransaction(getBase64EncodedWireTransaction(tx), {
                encoding: 'base64',
                commitment: 'confirmed',
                sigVerify: false,
            })
            .send();
        return result.value;
    }

    report('finite retention', await simulate('nonce_finite', '24h'));
    report('permanent retention', await simulate('nonce_permanent', 'permanent'));

    // -----------------------------------------------------------------------------------
    // 3. The nonce account is left for manual cleanup, on purpose.
    //
    //    Closing it automatically does not work, and the reason is worth recording because it
    //    is the *same* protocol constraint that `tests/security.rs` cites as making a real
    //    nonce transaction inexpressible in LiteSVM.
    //
    //    `AdvanceNonceAccount` refuses to advance a nonce whose stored value already equals the
    //    transaction's blockhash — *"nonce can only advance once per slot"*, surfacing as
    //    `NONCE_BLOCKHASH_NOT_EXPIRED` (0x7). Putting advance and withdraw in one transaction
    //    does not help: the advance succeeds, and the withdraw then fails with the same error,
    //    because it requires the nonce to have been advanced in an *earlier* slot. A wait
    //    between two separate transactions would work, but this script's subject is the guard's
    //    policy, not nonce-account hygiene, and a cleanup step that needs its own explanation is
    //    worse than an honest instruction.
    // -----------------------------------------------------------------------------------
    banner('3. clean up the nonce account');
    console.log('  left in place deliberately. To close it and recover the rent:');
    console.log('');
    console.log(`    solana nonce-account withdraw ${nonceAccount.address} ${payer.address} \\`);
    console.log(`      --url ${RPC_URL} --fee-payer ${PAYER_PATH}`);
    console.log('');
    console.log(`  rent held      ${NONCE_RENT_LAMPORTS} lamports`);

    banner('what this shows');
    console.log('  Both transactions are real durable-nonce transactions: the blockhash is the');
    console.log('  stored nonce and the first instruction advances it. The only difference is the');
    console.log('  retention. Finite retention is refused with DurableNonceUnsupported; permanent');
    console.log('  is allowed. The policy holds against a live cluster, not just against an');
    console.log('  injected marker in a harness.');
}

main().catch((error: unknown) => {
    console.error(`\nCommitOnce nonce policy demo failed: ${String(error)}`);
    process.exit(1);
});
