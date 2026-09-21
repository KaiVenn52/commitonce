/**
 * Where the funding keypair comes from.
 *
 * The demo owns no keypair and never writes one to disk. Every run mints a fresh authority
 * in memory, funds it from a payer named by the environment, and drops it at exit. That is
 * what makes repeated runs behave identically: the counter PDA is derived from the
 * authority (`[b"counter", owner]`), so a fresh authority always starts from a counter
 * account that does not exist yet, and both scenarios always start at zero.
 *
 * Two environment variables are accepted, because the two shapes are genuinely useful:
 *
 *   PAYER_KEYPAIR        a path to a file holding the solana CLI's JSON array of 64 bytes
 *   PAYER_KEYPAIR_JSON   that same JSON array, inline (handy in CI, or from a secret store)
 *
 * `PAYER_KEYPAIR_JSON` wins if both are set, and the demo prints which source it used.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

import { createKeyPairSignerFromBytes, getBase58Codec, type KeyPairSigner } from '@solana/kit';

import { ConfigError } from './errors.ts';

/** Path to a keypair file, in the solana CLI's JSON array format. */
export const PAYER_KEYPAIR_PATH_VAR = 'PAYER_KEYPAIR';

/** The same JSON array, passed inline rather than through a file. */
export const PAYER_KEYPAIR_JSON_VAR = 'PAYER_KEYPAIR_JSON';

export type Payer = {
    readonly signer: KeyPairSigner;
    /** Human-readable description of where the key came from, for the run header. */
    readonly source: string;
};

/** The message a user sees when neither variable is set. It has to be actionable. */
const MISSING_PAYER_HELP = [
    `CommitOnce demo: no funding keypair configured.`,
    ``,
    `Set one of these before running the demo:`,
    ``,
    `  PAYER_KEYPAIR       path to a solana CLI keypair file (JSON array of 64 bytes)`,
    `  PAYER_KEYPAIR_JSON  the raw JSON array contents`,
    ``,
    `bash / zsh:`,
    `  export PAYER_KEYPAIR=~/.config/solana/id.json`,
    `  export PAYER_KEYPAIR_JSON="$(cat ~/.config/solana/id.json)"`,
    ``,
    `PowerShell (reading the WSL keypair over the UNC path):`,
    `  $env:PAYER_KEYPAIR = '\\\\wsl.localhost\\Ubuntu\\home\\<user>\\.config\\solana\\id.json'`,
    `  $env:PAYER_KEYPAIR_JSON = Get-Content -Raw '\\\\wsl.localhost\\Ubuntu\\home\\<user>\\.config\\solana\\id.json'`,
    ``,
    `The keypair must hold devnet SOL: a run spends roughly 0.005 SOL across two funded`,
    `authorities (counter rent, receipt rent, and fees). The key is only ever used to pay`,
    `for and sign the two funding transfers; it is never the intent authority.`,
].join('\n');

/** Expand a leading `~` so `~/.config/solana/id.json` works from any shell. */
function expandHome(path: string): string {
    if (path === '~') {
        return homedir();
    }
    if (path.startsWith('~/') || path.startsWith('~\\')) {
        return resolve(homedir(), path.slice(2));
    }
    return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

/**
 * Validate the solana CLI keypair format and return the 64 raw bytes.
 *
 * Every failure mode gets its own message: a demo that dies with "cannot read property 0 of
 * undefined" teaches the reader nothing.
 */
export function parseKeypairBytes(json: string, source: string): Uint8Array {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (error) {
        throw new ConfigError(
            `CommitOnce demo: ${source} is not valid JSON (${error instanceof Error ? error.message : String(error)}). ` +
                `Expected the solana CLI keypair format: a JSON array of 64 byte values, ` +
                `as produced by \`solana-keygen new\`.`,
        );
    }
    if (!Array.isArray(parsed)) {
        throw new ConfigError(
            `CommitOnce demo: ${source} is valid JSON but not an array (got ${typeof parsed}). ` +
                `Expected a JSON array of 64 byte values.`,
        );
    }
    if (parsed.length !== 64) {
        throw new ConfigError(
            `CommitOnce demo: ${source} holds ${parsed.length} values, but a solana keypair is 64 bytes ` +
                `(32 secret key bytes followed by the 32 public key bytes). ` +
                `If this file holds only a 32-byte seed, use \`solana-keygen new\` to regenerate it.`,
        );
    }
    const bytes = new Uint8Array(64);
    for (let index = 0; index < parsed.length; index += 1) {
        const value: unknown = parsed[index];
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
            throw new ConfigError(
                `CommitOnce demo: ${source} has an invalid byte at index ${index} (${JSON.stringify(value)}). ` +
                    `Every element must be an integer in 0..255.`,
            );
        }
        bytes[index] = value;
    }
    return bytes;
}

/**
 * Load the payer named by the environment.
 *
 * The public half embedded in the file is checked against the address the signer actually
 * derives. A keypair whose two halves disagree would otherwise fail much later, as a
 * signature error on a live transaction, with no hint about the cause.
 */
export async function loadPayer(env: NodeJS.ProcessEnv): Promise<Payer> {
    const inline = env[PAYER_KEYPAIR_JSON_VAR]?.trim();
    const path = env[PAYER_KEYPAIR_PATH_VAR]?.trim();

    let json: string;
    let source: string;

    if (inline !== undefined && inline.length > 0) {
        json = inline;
        source = `$${PAYER_KEYPAIR_JSON_VAR}`;
    } else if (path !== undefined && path.length > 0) {
        const expanded = expandHome(path);
        try {
            json = await readFile(expanded, 'utf8');
        } catch (error) {
            throw new ConfigError(
                `CommitOnce demo: $${PAYER_KEYPAIR_PATH_VAR} is set to ${path} ` +
                    `(resolved to ${expanded}) but the file could not be read: ` +
                    `${error instanceof Error ? error.message : String(error)}`,
            );
        }
        source = `$${PAYER_KEYPAIR_PATH_VAR} (${expanded})`;
    } else {
        throw new ConfigError(MISSING_PAYER_HELP);
    }

    const bytes = parseKeypairBytes(json, source);
    const signer = await createKeyPairSignerFromBytes(bytes);

    const embeddedPublicKey = getBase58Codec().decode(bytes.slice(32));
    if (embeddedPublicKey !== signer.address) {
        throw new ConfigError(
            `CommitOnce demo: ${source} is internally inconsistent. The last 32 bytes decode to ` +
                `${embeddedPublicKey}, but the key material derives ${signer.address}. ` +
                `The file is corrupt or was hand-edited; regenerate it with \`solana-keygen\`.`,
        );
    }

    return { signer, source };
}
