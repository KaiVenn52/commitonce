/**
 * Verify that `@commitonce/solana` works as an **installed package**, not just through
 * workspace links.
 *
 * Every consumer inside this repository reaches the SDK through pnpm's workspace symlink,
 * and a symlink hides exactly the faults that break a real install: a missing `files`
 * entry, an `exports` map that does not resolve, a `types` path that points at nothing, a
 * runtime dependency that was only present because the monorepo hoisted it to the root.
 * Nobody outside this repository has ever installed the package, so this script stands in
 * for the first person who does.
 *
 * It:
 *   1. packs the SDK with `pnpm pack`
 *   2. installs the tarball into a throwaway project in the OS temp directory
 *   3. asserts the install did not resolve back into the monorepo (which would prove nothing)
 *   4. asserts the shipped file list is the intended one, and that `src/`, `test/`,
 *      `scripts/` and `tsconfig.json` are NOT shipped
 *   5. runs the same assertions under both ESM and CJS against a golden vector pinned in
 *      `packages/sdk/test/vectors.test.ts`
 *   6. typechecks a consumer against the shipped `.d.ts` files
 *
 * **This needs the network** (`npm install` fetches `@solana/kit`), which is why it is not
 * part of `verify.sh`: that script is deliberately hermetic. Run it when you have network.
 *
 * Run: node scripts/check-package.mjs
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const SDK = join(REPO, 'packages', 'sdk');
const SANDBOX = join(tmpdir(), 'commitonce-sdk-consumer');

/** Must match `packages/sdk/test/vectors.test.ts`. */
const GOLDEN = {
    authority: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    namespace: 'demo:counter',
    idempotencyKey: 'order_928',
    receipt: '7vMcWBtiMjeFgpx96E5ZtVZoYeRLn5Fu57RcTtzJeh9J',
    bump: 254,
};

/**
 * Run a command through a shell.
 *
 * `execFileSync('pnpm.cmd', ...)` fails with EINVAL on Windows: a `.cmd` file is not
 * executable without a terminal, so Node refuses to spawn it directly. `execSync` goes via
 * cmd.exe, which is the only way to invoke pnpm and npm here.
 */
function run(command, cwd) {
    return execSync(command, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function fail(message) {
    console.error(`\nPACKAGE CHECK FAILED: ${message}`);
    process.exit(1);
}

// ---------------------------------------------------------------------------------------
console.log('1/6  cleaning the sandbox');
rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(SANDBOX, { recursive: true });

console.log('2/6  packing the SDK');
run(`${pnpm} pack --pack-destination "${SANDBOX}"`, SDK);
const tarball = readdirSync(SANDBOX)
    .filter((name) => name.endsWith('.tgz'))
    .map((name) => join(SANDBOX, name))[0];
if (tarball === undefined) {
    fail('pnpm pack produced no tarball');
}
console.log(`     ${basename(tarball)}  ${statSync(tarball).size} bytes`);

console.log('3/6  installing into a project outside the workspace');
writeFileSync(
    join(SANDBOX, 'package.json'),
    JSON.stringify({ name: 'sdk-consumer', private: true, version: '0.0.0' }, null, 2),
);
run(`${npm} install --no-audit --no-fund "${tarball}" @solana/kit@8.3.0`, SANDBOX);

const installed = join(SANDBOX, 'node_modules', '@commitonce', 'solana');
if (!existsSync(installed)) {
    fail('@commitonce/solana was not installed');
}
// A symlink back into the monorepo would make every assertion below vacuous.
if (realpathSync(installed).startsWith(realpathSync(REPO))) {
    fail(`the install resolved back into the workspace at ${realpathSync(installed)}`);
}
console.log(`     installed to ${realpathSync(installed)}`);

console.log('4/6  checking what the tarball actually ships');
const shipped = readdirSync(installed).sort();
console.log(`     contents: ${shipped.join(' ')}`);
for (const required of ['dist', 'package.json', 'README.md']) {
    if (!shipped.includes(required)) {
        fail(`the tarball is missing ${required}`);
    }
}
for (const forbidden of ['src', 'test', 'scripts', 'node_modules', 'tsconfig.json']) {
    if (shipped.includes(forbidden)) {
        fail(`the tarball ships ${forbidden}, which it should not`);
    }
}

// ---------------------------------------------------------------------------------------
// The consumer. It imports only the package root, the way a user would.
const consumer = `
import assert from 'node:assert/strict';
import {
    COMMIT_ONCE_PROGRAM_ADDRESS,
    COMMIT_ONCE_ERROR_CODES,
    RECEIPT_ACCOUNT_SIZE,
    RECEIPT_RENT_LAMPORTS,
    classifyError,
    deriveReceiptAddress,
    idempotencyKeyHash,
    isAlreadyCommitted,
    namespaceHash,
    prepareIntent,
} from '@commitonce/solana';

const GOLDEN = ${JSON.stringify(GOLDEN)};

assert.equal(COMMIT_ONCE_PROGRAM_ADDRESS, 'CiiKHnzF1u9Nr5CuD7FgouN5oHs7pNeCUFuRgBCJrLnB');
assert.equal(RECEIPT_ACCOUNT_SIZE, 202);
assert.equal(RECEIPT_RENT_LAMPORTS, 1676400n);
assert.equal(COMMIT_ONCE_ERROR_CODES.AlreadyCommitted, 6000);
assert.equal(COMMIT_ONCE_ERROR_CODES.InstructionScanInconclusive, 6011);

const [receipt, bump] = await deriveReceiptAddress({
    authority: GOLDEN.authority,
    namespaceHash: await namespaceHash(GOLDEN.namespace),
    idempotencyKeyHash: await idempotencyKeyHash(GOLDEN.idempotencyKey),
});
assert.equal(receipt, GOLDEN.receipt, 'receipt PDA must match the pinned golden vector');
assert.equal(bump, GOLDEN.bump);

const guard = await prepareIntent({
    authority: GOLDEN.authority,
    namespace: GOLDEN.namespace,
    idempotencyKey: GOLDEN.idempotencyKey,
    intent: { n: 1 },
});
assert.equal(guard.receipt, GOLDEN.receipt);
assert.equal(guard.retentionSeconds, 86400n);
assert.equal(guard.instruction.data.length, 144);
assert.equal(guard.instruction.accounts.length, 4);

const classified = classifyError(new Error('custom program error: 0x1770'));
assert.equal(classified.kind, 'commit-once');
assert.equal(classified.name, 'AlreadyCommitted');
assert.equal(isAlreadyCommitted(new Error('custom program error: 0x1770')), true);

console.log('     ESM consumer: all assertions passed');
`;

const consumerCjs = consumer
    .replace(
        "import assert from 'node:assert/strict';",
        "const assert = require('node:assert/strict');",
    )
    .replace(
        /import \{[\s\S]*?\} from '@commitonce\/solana';/,
        "const {\n    COMMIT_ONCE_PROGRAM_ADDRESS, COMMIT_ONCE_ERROR_CODES, RECEIPT_ACCOUNT_SIZE,\n    RECEIPT_RENT_LAMPORTS, classifyError, deriveReceiptAddress, idempotencyKeyHash,\n    isAlreadyCommitted, namespaceHash, prepareIntent,\n} = require('@commitonce/solana');\n(async () => {",
    )
    .replace(
        "console.log('     ESM consumer: all assertions passed');",
        "console.log('     CJS consumer: all assertions passed');\n})();",
    );

writeFileSync(join(SANDBOX, 'consumer.mjs'), consumer, 'utf8');
writeFileSync(join(SANDBOX, 'consumer.cjs'), consumerCjs, 'utf8');

console.log('5/6  running the consumer under ESM and CJS');
console.log(run('node consumer.mjs', SANDBOX).trimEnd());
console.log(run('node consumer.cjs', SANDBOX).trimEnd());

// ---------------------------------------------------------------------------------------
// The shipped `.d.ts` files must resolve without the monorepo present.
console.log('6/6  typechecking a consumer against the shipped types');
writeFileSync(
    join(SANDBOX, 'types-probe.ts'),
    `import { address } from '@solana/kit';\n` +
        `import { prepareIntent, type CommitOnceErrorName } from '@commitonce/solana';\n` +
        `const name: CommitOnceErrorName = 'AlreadyCommitted';\n` +
        `export const probe = async (): Promise<string> =>\n` +
        `    (await prepareIntent({ authority: address('${GOLDEN.authority}'), namespace: 'n', idempotencyKey: 'k', intent: {} })).receipt + name;\n`,
    'utf8',
);
writeFileSync(
    join(SANDBOX, 'tsconfig.json'),
    JSON.stringify(
        {
            compilerOptions: {
                module: 'nodenext',
                moduleResolution: 'nodenext',
                target: 'es2022',
                strict: true,
                noEmit: true,
                skipLibCheck: true,
            },
            include: ['types-probe.ts'],
        },
        null,
        2,
    ),
);
// Read the compiler version from the SDK rather than pinning it here, so this check cannot
// drift from the version the repository actually builds with.
const sdkManifest = JSON.parse(readFileSync(join(SDK, 'package.json'), 'utf8'));
const typescriptVersion = sdkManifest.devDependencies.typescript;
run(`${npm} install --no-audit --no-fund --save-dev typescript@${typescriptVersion}`, SANDBOX);
const tscOutput = run(`${npx} tsc -p tsconfig.json`, SANDBOX).trim();
console.log(tscOutput === '' ? '     (no type errors)' : tscOutput);

console.log('\nPACKAGE CHECK PASSED — the tarball installs and works outside the workspace.');
