/**
 * The business program: `demo_counter`.
 *
 * This program knows nothing about CommitOnce. That is the point of the demo — the guard is
 * a separate instruction in the same atomic transaction, and the program being guarded does
 * not integrate, import, or even know the guard exists.
 *
 * The wire format below is the one the Rust integration suite uses
 * (`programs/commit-once/tests/common/mod.rs`), and it is the one in
 * `target/idl/demo_counter.json`:
 *
 *   instruction `initialize`   discriminator sha256("global:initialize")[0..8]
 *     accounts: counter (writable, PDA [b"counter", owner]), owner (writable signer),
 *               system_program (readonly)
 *   instruction `increment`    discriminator sha256("global:increment")[0..8]
 *     accounts: counter (writable, PDA [b"counter", owner]), owner (writable signer)
 *   account `Counter`          discriminator sha256("account:Counter")[0..8], 88 bytes
 *     offset  8  owner        pubkey
 *     offset 40  count        u64 LE      <-- the number the demo asserts on
 *     offset 48  last_slot    u64 LE
 *     offset 56  last_actor   pubkey
 *
 * Nothing here is copied on trust: `assertDemoCounterWireFormat()` recomputes every
 * discriminator from its preimage at startup and fails loudly on a mismatch. A demo whose
 * whole claim is "the second attempt did not run the business instruction" must not be
 * reading the counter out of the wrong offset because an IDL changed under it.
 */

import {
    AccountRole,
    address,
    fetchEncodedAccount,
    getAddressDecoder,
    getAddressEncoder,
    getProgramDerivedAddress,
    type Address,
    type Instruction,
} from '@solana/kit';
import { sha256, SYSTEM_PROGRAM_ADDRESS } from '@commitonce/solana';

import type { DemoRpc } from './solana.ts';

/** Derived from `deploy-keys/demo_counter-keypair.json`; identical on every cluster. */
export const DEMO_COUNTER_PROGRAM_ADDRESS: Address = address(
    'EnMnEKVFXFCTTMJYs7C6HhYhsS8MqLrhNVbx11LdeSh5',
);

const COUNTER_SEED = new TextEncoder().encode('counter');

const INITIALIZE_DISCRIMINATOR = new Uint8Array([175, 175, 109, 31, 13, 152, 155, 237]);
const INCREMENT_DISCRIMINATOR = new Uint8Array([11, 18, 104, 9, 104, 174, 59, 33]);
const COUNTER_ACCOUNT_DISCRIMINATOR = new Uint8Array([255, 176, 4, 245, 188, 253, 124, 25]);

/** `8 discriminator | 32 owner | 8 count | 8 last_slot | 32 last_actor`. */
const COUNTER_ACCOUNT_LENGTH = 88;

/** Byte offset of `count`, the only field the demo asserts on. */
const COUNTER_COUNT_OFFSET = 40;

const addressDecoder = getAddressDecoder();
const addressEncoder = getAddressEncoder();

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

async function anchorDiscriminator(preimage: string): Promise<Uint8Array> {
    return (await sha256(new TextEncoder().encode(preimage))).slice(0, 8);
}

/**
 * Recompute every Anchor discriminator from `sha256("<namespace>:<name>")[0..8]` and compare
 * it to the constant this module ships. This is a self-check, not a formality: it is what
 * makes the hardcoded wire format trustworthy at runtime rather than on inspection.
 */
export async function assertDemoCounterWireFormat(): Promise<readonly string[]> {
    const checks: readonly [string, Uint8Array, Uint8Array][] = [
        ['global:initialize', await anchorDiscriminator('global:initialize'), INITIALIZE_DISCRIMINATOR],
        ['global:increment', await anchorDiscriminator('global:increment'), INCREMENT_DISCRIMINATOR],
        ['account:Counter', await anchorDiscriminator('account:Counter'), COUNTER_ACCOUNT_DISCRIMINATOR],
    ];
    for (const [name, computed, expected] of checks) {
        if (!bytesEqual(computed, expected)) {
            throw new Error(
                `CommitOnce demo: wire format self-check failed for ${name}. ` +
                    `sha256("${name}")[0..8] is [${computed.join(', ')}] but this demo carries ` +
                    `[${expected.join(', ')}]. The demo's hardcoded interface to demo_counter is stale; ` +
                    `re-derive it from target/idl/demo_counter.json.`,
            );
        }
    }
    return checks.map(([name]) => name);
}

/** The `Counter` PDA for an owner: `[b"counter", owner]` under the demo_counter program. */
export async function deriveCounterAddress(owner: Address): Promise<Address> {
    const [counter] = await getProgramDerivedAddress({
        programAddress: DEMO_COUNTER_PROGRAM_ADDRESS,
        // The seed is the raw 32 public-key bytes, not the base58 text of the address.
        seeds: [COUNTER_SEED, addressEncoder.encode(owner)],
    });
    return counter;
}

/** Create the counter for `owner`. Fails if it already exists, which is why each run mints a fresh authority. */
export async function createInitializeCounterInstruction(owner: Address): Promise<Instruction> {
    const counter = await deriveCounterAddress(owner);
    return {
        programAddress: DEMO_COUNTER_PROGRAM_ADDRESS,
        accounts: [
            { address: counter, role: AccountRole.WRITABLE },
            { address: owner, role: AccountRole.WRITABLE_SIGNER },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: INITIALIZE_DISCRIMINATOR,
    };
}

/**
 * The business action. This is the instruction CommitOnce is guarding: it is the thing that
 * must happen once, and that must not happen a second time when a client retries.
 */
export async function createIncrementCounterInstruction(owner: Address): Promise<Instruction> {
    const counter = await deriveCounterAddress(owner);
    return {
        programAddress: DEMO_COUNTER_PROGRAM_ADDRESS,
        accounts: [
            { address: counter, role: AccountRole.WRITABLE },
            { address: owner, role: AccountRole.WRITABLE_SIGNER },
        ],
        data: INCREMENT_DISCRIMINATOR,
    };
}

export type CounterState = {
    readonly owner: Address;
    readonly count: bigint;
    readonly lastSlot: bigint;
    readonly lastActor: Address;
};

/** Decode a `Counter` account straight out of its bytes. */
export function decodeCounter(data: Uint8Array): CounterState {
    if (data.length !== COUNTER_ACCOUNT_LENGTH) {
        throw new Error(
            `CommitOnce demo: the account at the counter PDA is ${data.length} bytes, expected ` +
                `${COUNTER_ACCOUNT_LENGTH}. It is not a demo_counter Counter account.`,
        );
    }
    if (!bytesEqual(data.subarray(0, 8), COUNTER_ACCOUNT_DISCRIMINATOR)) {
        throw new Error(
            'CommitOnce demo: the account at the counter PDA does not begin with the Counter ' +
                'discriminator, so the value read from it would be meaningless.',
        );
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return {
        owner: addressDecoder.decode(data.subarray(8, 40)),
        count: view.getBigUint64(COUNTER_COUNT_OFFSET, true),
        lastSlot: view.getBigUint64(48, true),
        lastActor: addressDecoder.decode(data.subarray(56, 88)),
    };
}

export type CounterRead = {
    readonly address: Address;
    readonly state: CounterState;
};

/**
 * Read the counter from the chain. Returns `null` when the account does not exist, so a
 * caller can never confuse "zero increments" with "no such counter".
 */
export async function fetchCounter(rpc: DemoRpc, owner: Address): Promise<CounterRead | null> {
    const counterAddress = await deriveCounterAddress(owner);
    const account = await fetchEncodedAccount(rpc, counterAddress, { commitment: 'confirmed' });
    if (!account.exists) {
        return null;
    }
    if (account.programAddress !== DEMO_COUNTER_PROGRAM_ADDRESS) {
        throw new Error(
            `CommitOnce demo: an account exists at the counter PDA ${counterAddress} but is owned by ` +
                `${account.programAddress}, not by demo_counter ${DEMO_COUNTER_PROGRAM_ADDRESS}. ` +
                'Refusing to read a count out of it.',
        );
    }
    return { address: counterAddress, state: decodeCounter(account.data) };
}
