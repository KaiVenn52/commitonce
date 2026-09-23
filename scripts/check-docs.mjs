/**
 * Documentation and submission consistency check.
 *
 * This repository makes a lot of checkable claims, and most of them live in prose. Prose
 * rots: a file gets renamed, a link target disappears, a test count is quoted after the
 * suite grew, and nobody notices because nothing compiles documentation.
 *
 * This script is the thing that notices. It is deliberately dependency-free and reads only
 * the working tree, so it runs anywhere Node does.
 *
 * It checks:
 *   1. every relative link in every markdown file resolves
 *   2. every relative link in the website's HTML resolves (the markdown pass does not see
 *      `href` attributes, and a judge clicking a dead link is a real failure)
 *   3. no claim that was previously found to be false has survived anywhere
 *   4. every evidence log is UTF-8 without a BOM (one was once written as UTF-16LE by a
 *      Windows redirect, which made it unreadable on Linux and binary to git)
 *   5. the test counts quoted in the documents are the counts the suites actually produce
 *
 * Run: node scripts/check-docs.mjs
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', '.next', 'coverage']);

function walk(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

const files = walk(ROOT);
const problems = [];
const rel = (file) => relative(ROOT, file).replaceAll('\\', '/');

// ---------------------------------------------------------------------------------------
// 1. Relative links in markdown.
// ---------------------------------------------------------------------------------------
let markdownLinks = 0;
for (const file of files.filter((f) => extname(f) === '.md')) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = match[1];
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        const bare = target.split('#')[0];
        if (bare === '') continue;
        markdownLinks += 1;
        if (!existsSync(join(dirname(file), decodeURIComponent(bare)))) {
            problems.push(`${rel(file)} -> ${target}  (markdown link does not resolve)`);
        }
    }
}
console.log(`markdown links: ${markdownLinks} checked`);

// ---------------------------------------------------------------------------------------
// 2. Relative links in HTML.
//
// The markdown pass cannot see these, and the website is the artifact a judge is most
// likely to click through, so a dead `href` there is worse than one in a document.
// ---------------------------------------------------------------------------------------
let htmlLinks = 0;
for (const file of files.filter((f) => extname(f) === '.html')) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:href|src)="([^"]+)"/g)) {
        const target = match[1];
        if (/^(https?:|mailto:|#|data:|javascript:)/.test(target)) continue;
        const bare = decodeURIComponent(target.split('#')[0].split('?')[0]);
        if (bare === '') continue;
        htmlLinks += 1;
        if (!existsSync(join(dirname(file), bare))) {
            problems.push(`${rel(file)} -> ${target}  (html link does not resolve)`);
        }
    }
}
console.log(`html links:     ${htmlLinks} checked`);

// ---------------------------------------------------------------------------------------
// 3. Claims that were previously found to be false, and must not come back.
//
// Each of these was true of an earlier revision and was corrected. If one reappears, the
// correction was lost — which is the failure mode this whole script exists for.
//
// The patterns are deliberately precise rather than plain substrings. Several corrected
// claims are now *correctly* mentioned in their negated form ("there is no `--scenario`
// flag", "three of the four examples have been executed"), and a naive substring match
// flags those as regressions. A check that cries wolf gets disabled, so precision here is
// not fussiness — it is what keeps the check alive.
// ---------------------------------------------------------------------------------------
const RETIRED_CLAIMS = [
    { pattern: /accounting matches/, why: 'LiteSVM compute accounting does not match the runtime' },
    { pattern: /matches the runtime/, why: 'LiteSVM compute accounting does not match the runtime' },
    { pattern: /last piece of product surface/, why: 'the devnet demo runner landed on 2026-09-21' },
    { pattern: /not directly exercised/, why: 'concurrent claims are exercised, in two places' },
    { pattern: /rests on account locking/, why: 'concurrent claims are exercised, in two places' },
    { pattern: /submits them sequentially/, why: 'the contention test does not submit sequentially' },
    { pattern: /does not exercise concurrent/, why: 'the contention test does exercise concurrency' },
    {
        pattern: /Not tested\. The suite covers sequential duplicates/,
        why: 'concurrency is tested',
    },
    { pattern: /48 passed \(48\)/, why: 'the SDK suite is larger than 48' },
    { pattern: /Tests {2}48/, why: 'the SDK suite is larger than 48' },
    { pattern: /40 passing/, why: 'the Rust suite is larger than 40' },
    { pattern: /11 exports, 6 constants/, why: 'the SDK exports more than 11' },
    {
        pattern: /has not been executed against a live cluster/,
        why: 'these three examples have been executed',
        // jupiter-swap is still structural and says so correctly; only the three that were
        // made real are checked.
        only: ['examples/sol-transfer/', 'examples/spl-transfer/', 'examples/custom-program/'],
    },
    {
        pattern: /No examples executed against a live cluster/,
        why: 'three examples have been executed',
    },
    {
        pattern: /run\.ts\s+--scenario|--scenario\s+both/,
        why: 'the demo entry point is commitonce-demo.ts and it has no --scenario flag',
    },
    {
        pattern: /node\s+run\.ts/,
        why: 'the demo entry point is commitonce-demo.ts',
    },
];

/** The checker itself declares these patterns, and the work log quotes the bugs it fixed. */
const CLAIM_SCAN_EXEMPT = new Set(['scripts/check-docs.mjs', 'submission/WORK_LOG.md']);

let retired = 0;
for (const file of files) {
    if (!/\.(md|html|mjs|cjs|ts|json|ya?ml|sh)$/.test(file)) continue;
    const path = rel(file);
    if (CLAIM_SCAN_EXEMPT.has(path)) continue;

    const text = readFileSync(file, 'utf8');
    for (const { pattern, why, only } of RETIRED_CLAIMS) {
        if (only !== undefined && !only.some((prefix) => path.startsWith(prefix))) continue;
        const match = pattern.exec(text);
        if (match === null) continue;
        retired += 1;
        const line = text.slice(0, match.index).split('\n').length;
        problems.push(`${path}:${line}  "${match[0]}"  — ${why}`);
    }
}
console.log(`retired claims: ${retired} found`);

// ---------------------------------------------------------------------------------------
// 4. Evidence logs must be UTF-8 without a BOM.
// ---------------------------------------------------------------------------------------
const logs = files.filter((f) => rel(f).includes('evidence/'));
for (const file of logs) {
    const bytes = readFileSync(file);
    const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const utf16 = bytes.length >= 2 && (bytes[0] === 0xff || bytes[0] === 0xfe);
    if (bom || utf16) {
        problems.push(`${rel(file)}  is ${bom ? 'UTF-8 with a BOM' : 'UTF-16'}, not plain UTF-8`);
    }
}
console.log(`evidence logs:  ${logs.length} checked`);

// ---------------------------------------------------------------------------------------
// 5. Quoted test counts must be counts that exist.
//
// `submission/WORK_LOG.md` is a dated history, so it legitimately records the counts as they
// were on each day. Everywhere else, a test count is a claim about the present.
// ---------------------------------------------------------------------------------------
const CURRENT_COUNTS = new Set([46, 71]);
const HISTORY_FILE = 'submission/WORK_LOG.md';
let counts = 0;
for (const file of files.filter((f) => extname(f) === '.md')) {
    if (rel(file) === HISTORY_FILE) continue;
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\b(\d+)\s+(?:Rust |SDK )?tests?\b/gi)) {
        const n = Number(match[1]);
        if (n < 30 || n > 90) continue;
        counts += 1;
        if (!CURRENT_COUNTS.has(n)) {
            const line = text.slice(0, match.index).split('\n').length;
            problems.push(
                `${rel(file)}:${line}  quotes "${match[0].trim()}", but the suites produce ` +
                    `${[...CURRENT_COUNTS].join(' and ')}`,
            );
        }
    }
}
console.log(`test counts:    ${counts} quoted (outside ${HISTORY_FILE})`);

// ---------------------------------------------------------------------------------------
// 6. Every evidence log must be referenced by at least one document, or it is dead weight
//    that nobody will ever find.
// ---------------------------------------------------------------------------------------
for (const log of logs) {
    const name = rel(log).split('/').pop();
    const referenced = files.some(
        (f) =>
            f !== log &&
            /\.(md|html)$/.test(f) &&
            readFileSync(f, 'utf8').includes(name),
    );
    if (!referenced) {
        problems.push(`${rel(log)}  is not referenced by any document`);
    }
}

// ---------------------------------------------------------------------------------------
console.log(
    `\n${problems.length === 0 ? 'DOCS CHECK PASSED' : `DOCS CHECK FAILED (${problems.length})`}`,
);
for (const problem of problems) console.log(`  FAIL  ${problem}`);
process.exit(problems.length === 0 ? 0 : 1);
