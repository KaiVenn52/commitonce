#!/usr/bin/env node
/**
 * Do the SDK's constants still agree with the program's?
 *
 * Six values are declared twice, once in Rust and once in TypeScript:
 *
 *   RECEIPT_SEED, RECEIPT_VERSION, PERMANENT_RETENTION,
 *   MIN_RETENTION_SECONDS, MAX_RETENTION_SECONDS, SLOTS_PER_SECOND
 *
 * The SDK cannot import them — they are compiled into an onchain program — so they are copied by
 * hand. Nothing checked that the copies agreed, which means a change to the program's retention
 * bounds would leave the SDK validating against the old range: `prepare()` would happily build a
 * transaction the program then rejects with `InvalidRetention`, and the failure would surface at
 * the cluster rather than at the call site.
 *
 * This reads both files and compares. It is deliberately a source-level check rather than a
 * runtime one, because the point is to catch the change at review time.
 *
 * Read-only. No network. Exit code 0 means the constants agree.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const RUST = join(ROOT, 'programs', 'commit-once', 'src', 'constants.rs');
const TS = join(ROOT, 'packages', 'sdk', 'src', 'constants.ts');

const rust = readFileSync(RUST, 'utf8');
const ts = readFileSync(TS, 'utf8');

/** `pub const NAME: type = value;` — value kept as text, evaluated by `evalRust`. */
function rustConst(name) {
    const match = new RegExp(`pub const ${name}\\s*:\\s*[^=]+=\\s*([^;]+);`).exec(rust);
    if (match === null) return null;
    return evalRust(match[1].trim());
}

/**
 * Evaluate the small arithmetic the Rust constants use (`60 * 60`, `365 * 24 * 60 * 60`).
 * Deliberately not a general evaluator: anything outside digits, whitespace and `*` is rejected
 * rather than guessed at.
 */
function evalRust(expression) {
    const stripped = expression.replaceAll('_', '');
    if (!/^[\d\s*()]+$/.test(stripped)) return { unsupported: expression };
    // eslint-disable-next-line no-new-func -- input is restricted to digits and operators above
    return { value: BigInt(Function(`"use strict";return (${stripped});`)()) };
}

/** `export const NAME = <literal>;` */
function tsConst(name) {
    const match = new RegExp(`export const ${name}\\s*=\\s*([^;]+);`).exec(ts);
    if (match === null) return null;
    return match[1].trim();
}

/** Pull a BigInt out of a TS literal: `3_600n`, `1`, `0n`. */
function tsBigInt(literal) {
    const cleaned = literal.replaceAll('_', '');
    const match = /^(\d+)n?$/.exec(cleaned);
    return match === null ? null : BigInt(match[1]);
}

const problems = [];

// ---- the shared scalars ---------------------------------------------------------------
const SHARED = [
    ['RECEIPT_VERSION', 'u8'],
    ['PERMANENT_RETENTION', 'u64'],
    ['MIN_RETENTION_SECONDS', 'u64'],
    ['MAX_RETENTION_SECONDS', 'u64'],
    ['SLOTS_PER_SECOND', 'u64'],
];

let compared = 0;
for (const [name] of SHARED) {
    const fromRust = rustConst(name);
    if (fromRust === null) {
        problems.push(`programs/commit-once/src/constants.rs no longer declares ${name}`);
        continue;
    }
    if (fromRust.unsupported !== undefined) {
        problems.push(`${name} in Rust is not a plain integer expression: ${fromRust.unsupported}`);
        continue;
    }

    const fromTs = tsConst(name);
    if (fromTs === null) {
        problems.push(`packages/sdk/src/constants.ts no longer declares ${name}`);
        continue;
    }
    const tsValue = tsBigInt(fromTs);
    if (tsValue === null) {
        problems.push(`${name} in the SDK is not an integer literal: ${fromTs}`);
        continue;
    }

    compared += 1;
    if (fromRust.value !== tsValue) {
        problems.push(
            `${name} disagrees: program has ${fromRust.value}, SDK has ${tsValue}. ` +
                'The SDK would validate against a range the program does not accept.',
        );
    }
}

// ---- the seed, which is bytes rather than a number ------------------------------------
{
    const rustSeed = /pub const RECEIPT_SEED\s*:\s*&\[u8\]\s*=\s*b"([^"]*)"/.exec(rust)?.[1];
    // The SDK declaration carries a type annotation, so the `=` cannot be matched directly.
    const tsSeed = /RECEIPT_SEED\s*(?::[^=]+)?=\s*new TextEncoder\(\)\.encode\('([^']*)'\)/.exec(ts)?.[1];
    if (rustSeed === undefined || tsSeed === undefined) {
        problems.push('RECEIPT_SEED could not be read from one of the two files');
    } else {
        compared += 1;
        if (rustSeed !== tsSeed) {
            problems.push(`RECEIPT_SEED disagrees: program has "${rustSeed}", SDK has "${tsSeed}"`);
        }
    }
}

// ---- the receipt size, which the Rust suite pins and the SDK restates -------------------
//
// The program computes `LEN` as `8 + Self::INIT_SPACE`, so there is no literal to read. The Rust
// suite asserts it equals 202 in two places, and the SDK declares 202 independently. Comparing
// the SDK against the number the Rust suite enforces is what keeps them from drifting: if the
// receipt layout changes, the Rust assertion fails, and this check then fails too until the SDK
// is updated.
{
    const testFiles = ['wire_format.rs', 'benchmarks.rs'];
    let pinned = null;
    let pinnedIn = null;
    for (const name of testFiles) {
        const text = readFileSync(join(ROOT, 'programs', 'commit-once', 'tests', name), 'utf8');
        const match = /receipt_len\s*,\s*(\d+)|receipt_account_layout_is_exactly_(\d+)_bytes/.exec(text);
        if (match !== null) {
            pinned = Number(match[1] ?? match[2]);
            pinnedIn = name;
            break;
        }
    }

    const declared = /RECEIPT_ACCOUNT_SIZE\s*=\s*(\d+)/.exec(ts)?.[1];

    if (pinned === null) {
        problems.push(
            'no Rust test pins the receipt size any more, so the SDK value has nothing to agree with',
        );
    } else if (declared === undefined) {
        problems.push('packages/sdk/src/constants.ts no longer declares RECEIPT_ACCOUNT_SIZE');
    } else {
        compared += 1;
        if (Number(declared) !== pinned) {
            problems.push(
                `RECEIPT_ACCOUNT_SIZE disagrees: the Rust suite pins ${pinned} (${pinnedIn}), ` +
                    `the SDK declares ${declared}`,
            );
        }
    }
}

// ---- the rent derivation ----------------------------------------------------------------
//
// `RECEIPT_RENT_LAMPORTS` is a *formula*, not a literal, so there is no value to compare. What
// can be checked is that the formula is the right one: it must reference all three inputs. The
// first version of this check tried to read it as an integer, got `null`, and skipped — which
// meant it reported success without checking anything. Failing loudly on an unparseable
// declaration is the whole point.
{
    const declaration = /RECEIPT_RENT_LAMPORTS\s*=\s*([\s\S]*?);/.exec(ts)?.[1] ?? '';
    compared += 1;

    const REQUIRED = ['RECEIPT_ACCOUNT_SIZE', 'ACCOUNT_STORAGE_OVERHEAD', 'MAINNET_LAMPORTS_PER_BYTE'];
    const missing = REQUIRED.filter((name) => !declaration.includes(name));
    if (missing.length > 0) {
        problems.push(
            `RECEIPT_RENT_LAMPORTS does not derive from ${missing.join(', ')}; it reads ` +
                `"${declaration.trim().replace(/\s+/g, ' ')}"`,
        );
    } else {
        const size = Number(/RECEIPT_ACCOUNT_SIZE\s*=\s*(\d+)/.exec(ts)?.[1]);
        const overhead = Number(/ACCOUNT_STORAGE_OVERHEAD\s*=\s*([\d_]+)n?/.exec(ts)?.[1]?.replaceAll('_', ''));
        const perByte = Number(/MAINNET_LAMPORTS_PER_BYTE\s*=\s*([\d_]+)n?/.exec(ts)?.[1]?.replaceAll('_', ''));
        if ([size, overhead, perByte].some((v) => Number.isNaN(v))) {
            problems.push('could not read one of the three inputs to the rent derivation');
        } else {
            console.log(
                `receipt rent:   (${size} + ${overhead}) * ${perByte} = ${(size + overhead) * perByte} lamports`,
            );
        }
    }
}

// ---- version pins, which the documents quote ------------------------------------------
//
// Same defect class as the SBPF arch flag, and it has already happened three times in this
// project: litesvm 0.10 -> 0.16, Rust 1.89 -> 1.98, and the arch itself. In each case the
// manifest changed and several documents kept stating the old value as current. The README,
// the judge readme, the submission form and the project description all claimed SBPFv2 for a
// round after the build had moved to v3, and CI was pinned to v2 the whole time — so a green
// run never built what shipped.
//
// This reads the manifest and fails if a document states a different version as current. The
// historical narrative ("LiteSVM 0.10.0 could not verify a v3 ELF") is explicitly allowed,
// because a project that records its own history will legitimately mention old versions.
{
    const cargo = readFileSync(join(ROOT, 'programs', 'commit-once', 'Cargo.toml'), 'utf8');
    const toolchain = readFileSync(join(ROOT, 'rust-toolchain.toml'), 'utf8');

    // Scanned files: **every tracked text file**, not a list of documents.
    //
    // The first version named four documents for litesvm and two for Rust, and `verify.sh`
    // quotes the Rust pin in a prerequisite hint — so it sat outside the check and drifted from
    // 1.89.0 to 1.98.0 unnoticed. A hardcoded scope is the same failure as a workspace-scoped
    // `cargo fmt`: the thing that is not named is the thing that goes stale.
    const SCANNED = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
        .split('\n')
        .filter((f) => /\.(md|html|sh|mjs|yml|yaml|json|toml|ts)$/.test(f))
        // The work log records history and legitimately names old versions.
        .filter((f) => !f.includes('WORK_LOG') && !f.endsWith('Cargo.lock'));

    const PINS = [
        {
            name: 'litesvm',
            actual: /^litesvm = "([^"]+)"/m.exec(cargo)?.[1],
        },
        {
            name: 'rust',
            actual: /^channel = "([^"]+)"/m.exec(toolchain)?.[1],
        },
    ];

    for (const pin of PINS) {
        if (pin.actual === undefined) {
            problems.push(`could not read the ${pin.name} version from its manifest`);
            continue;
        }
        compared += 1;
        for (const rel of SCANNED) {
            const body = readFileSync(join(ROOT, rel), 'utf8');
            // Any version-shaped mention of this tool, then check whether it is the current one.
            const pattern =
                pin.name === 'litesvm'
                    ? /[Ll]ite[Ss][Vv][Mm][^\d\n]{0,4}(\d+\.\d+\.\d+)/g
                    // Anchored on `rust-toolchain`, because the claim being checked is
                    // specifically "what the toolchain manifest pins".
                    //
                    // A bare `Rust <version>` pattern was tried first and produced five false
                    // positives out of seven hits: the Solana platform-tools rustc (1.95.0-dev,
                    // a genuinely different toolchain), the deliberate `rust-version` MSRV in two
                    // Cargo.toml files (1.89.0, kept low on purpose and documented as such),
                    // Anchor's own 1.2.0 sitting next to the word "Rust", and an unrelated crate
                    // version in a research note. All five are correct text.
                    //
                    // what the pattern matches.
                    // what the pattern matches.
                    : /rust-toolchain[^\d\n]{0,40}(\d+\.\d+\.\d+)/gi;
            for (const match of body.matchAll(pattern)) {
                const found = match[1];
                if (found === pin.actual) continue;
                // Historical statements are fine; a bare version in a table is not.
                //
                // The window is the match's line **plus the next one**, because prose wraps and
                // the qualifier that makes a mention historical ("could not verify") frequently
                // lands on the following line. A one-line window reported EVIDENCE.md:57 as a
                // stale claim when the sentence two lines down says exactly why it is not.
                const lineStart = body.lastIndexOf('\n', match.index) + 1;
                const afterNext = body.indexOf('\n', body.indexOf('\n', match.index) + 1);
                const line = body.slice(lineStart, afterNext === -1 ? undefined : afterNext);
                // Phrases that mark a mention as a record of the past rather than a claim about
                // the present. Every one of them is a sentence this project actually wrote.
                const historical =
                    /could not verify|rejects v3 ELFs|did not implement|for most of|was v2 for|pinning \*\*Rust|shipped an \*\*SBPFv2|inexpressible|passes the transaction/.test(
                        line,
                    );
                if (historical) continue;
                problems.push(
                    `${rel} states ${pin.name} ${found}, but the manifest pins ${pin.actual}`,
                );
            }
        }
    }
}

// ---- the error range, which the documents quote ----------------------------------------
//
// Same class again: the program gained a twelfth error (6011, `InstructionScanInconclusive`) and
// four documents kept saying "6000–6010". The range appears in the architecture tree, the FAQ,
// an example's README and the API reference, and nothing tied any of them to the enum.
//
// This reads the program's error codes and fails if a document quotes a different range.
{
    const errorRs = readFileSync(join(ROOT, 'programs', 'commit-once', 'src', 'error.rs'), 'utf8');

    // The codes are **implicit**: Anchor's `#[error_code]` assigns 6000 + the variant's index,
    // and the source never writes a number. So the range is derived by counting the variants,
    // which also means inserting one in the middle renumbers everything after it — the reason
    // CONTRIBUTING says to append rather than insert.
    const body = /pub enum CommitOnceError \{([\s\S]*?)\n\}/.exec(errorRs)?.[1];
    const variants = body === undefined ? [] : [...body.matchAll(/^\s{4}([A-Z]\w*),\s*$/gm)].map((m) => m[1]);

    if (variants.length === 0) {
        problems.push('could not read any variants from the CommitOnceError enum');
    } else {
        const low = 6000;
        const high = 6000 + variants.length - 1;
        compared += 1;
        console.log(`error range:    ${low}-${high} (${variants.length} variants)`);
        for (const rel of ['docs/ARCHITECTURE.md', 'docs/FAQ.md', 'docs/API_REFERENCE.md', 'examples/custom-program/README.md']) {
            const body = readFileSync(join(ROOT, rel), 'utf8');
            // Any "6000" followed by a dash and another code.
            for (const match of body.matchAll(/(60\d\d)\s*[–—-]\s*(60\d\d)/g)) {
                if (Number(match[1]) === low && Number(match[2]) === high) continue;
                problems.push(
                    `${rel} quotes the error range as ${match[1]}–${match[2]}, but the program declares ${low}–${high}`,
                );
            }
        }
    }
}

console.log(`constants:      ${compared} compared across Rust and TypeScript`);
if (problems.length === 0) {
    console.log('\nCONSTANTS CHECK PASSED');
    process.exit(0);
}
console.log(`\nCONSTANTS CHECK FAILED (${problems.length})`);
for (const problem of problems) console.log(`  FAIL  ${problem}`);
process.exit(1);
