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
        // The earlier pattern above only matches one specific phrasing, in three specific
        // directories. This one caught a sentence in EVIDENCE.md that said the same wrong
        // thing a different way and lived outside those directories.
        pattern: /[Tt]he other three are structural/,
        why: 'three of the four examples have been executed; only jupiter-swap is structural',
    },
    {
        pattern: /One of the four[\s\S]{0,40}has additionally been executed/,
        why: 'three of the four examples have been executed, not one',
    },
    {
        // jupiter-swap was described as purely structural until it was composed against a real
        // Jupiter transaction in dry-run mode. The claim that survives is narrower: the
        // composition is verified, the execution is not. These patterns catch a regression to
        // the old, weaker description.
        pattern: /Jupiter[- ]swap (?:example )?(?:is|stays|remains) structural/,
        why: 'jupiter-swap has been composed against a real Jupiter transaction in dry-run mode',
    },
    {
        pattern: /has not been run against Jupiter's live API/,
        why: 'it has: a real transaction was fetched from Jupiter and the composition verified against it',
    },
    {
        pattern: /The Jupiter integration is structural/,
        why: 'the Jupiter integration has been run against the live API, though not executed end to end',
    },
    {
        pattern: /run\.ts\s+--scenario|--scenario\s+both/,
        why: 'the demo entry point is commitonce-demo.ts and it has no --scenario flag',
    },
    {
        pattern: /node\s+run\.ts/,
        why: 'the demo entry point is commitonce-demo.ts',
    },
    {
        // The slot deadline is one of TWO gates and `close_receipt` requires both, so the
        // effective deadline is the later of the two and a wrong constant can only delay
        // cleanup. The sentence that claimed otherwise survived in five files at once — the
        // architecture doc, the concepts doc, the security model, the technical overview and
        // the source constant's own comment — and contradicted the sentence immediately after
        // it every time. Measured slot rates: 3.77/s mainnet, 6.09/s devnet.
        pattern: /would silently shorten the advertised window/,
        why: 'cleanup requires both deadlines, so a wrong slot rate delays cleanup; it cannot shorten the window',
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
const CURRENT_COUNTS = new Set([54, 71]);
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
// 6. Orphaned markdown table rows.
//
// A row that has drifted away from its table renders as a paragraph of pipes, which looks like
// a formatting accident to a reader and hides real content. It is also easy to create by hand:
// inserting a section between a table and its last few rows leaves those rows stranded below.
// That happened in EVIDENCE.md, where four rows ended up after two prose sections.
//
// Distinguishing an orphan from a legitimate table header needs the *next* line, not the
// previous one: a header row is followed by a `|---|` separator, an orphan is not.
//
// Fenced code blocks are skipped. A TypeScript union type is written as a leading pipe
// (`| null`, `| { readonly kind: ... }`), which is indistinguishable from a table row without
// tracking the fence —and a check that flags five lines of a code sample gets switched off.
// ---------------------------------------------------------------------------------------
const isTableRow = (line) => /^\s*\|/.test(line);
const isSeparator = (line) => /^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes('-');
const isFence = (line) => /^\s*(```|~~~)/.test(line);

let orphans = 0;
for (const file of files.filter((f) => extname(f) === '.md')) {
    const lines = readFileSync(file, 'utf8').split('\n');
    let inFence = false;

    for (let i = 0; i < lines.length; i += 1) {
        if (isFence(lines[i])) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;
        if (!isTableRow(lines[i])) continue;

        // The previous non-blank line, which must also be outside a fence.
        let previous = null;
        for (let j = i - 1; j >= 0; j -= 1) {
            if (lines[j].trim() === '') continue;
            if (isFence(lines[j])) break;
            previous = lines[j];
            break;
        }
        if (previous !== null && isTableRow(previous)) continue; // mid-table, fine
        if (previous !== null && isSeparator(previous)) continue; // separator under a header

        // Starting a table. Legitimate only if the next non-blank line is a separator.
        let next = null;
        for (let j = i + 1; j < lines.length; j += 1) {
            if (lines[j].trim() === '') continue;
            if (isFence(lines[j])) break;
            next = lines[j];
            break;
        }
        if (next !== null && isSeparator(next)) continue;

        orphans += 1;
        problems.push(
            `${rel(file)}:${i + 1}  table row is not attached to a table: ` +
                `"${lines[i].trim().slice(0, 60)}"`,
        );
    }
}
console.log(`table rows:     ${orphans} orphaned`);

// ---------------------------------------------------------------------------------------
// 7. Every test the security model cites must exist.
//
// `docs/SECURITY_MODEL.md` §8 lists the failure modes that would break the guarantee and names
// the test guarding each one, "so that a reviewer can check them rather than trust the prose".
// That is only true while the names resolve. Rename a test and the document goes on asserting
// protection that nothing provides — the worst kind of documentation bug in a security model,
// because it reads as evidence.
//
// Only `Guarded by:` lines are read, and only backticked snake_case identifiers that are long
// enough to be test names. Field names like `expires_at_slot` appear in backticks throughout
// the same document and are not tests; a looser rule flags nine of them.
// ---------------------------------------------------------------------------------------
const securityModelPath = join(ROOT, 'docs', 'SECURITY_MODEL.md');
if (existsSync(securityModelPath)) {
    // Every `fn name(` in the Rust test suite.
    const definedTests = new Set();
    for (const file of files) {
        if (!/programs[\\/]commit-once[\\/]tests[\\/].*\.rs$/.test(file)) continue;
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/^\s*fn (\w+)\(/gm)) definedTests.add(match[1]);
    }

    const securityModel = readFileSync(securityModelPath, 'utf8');
    const cited = new Set();
    for (const block of securityModel.matchAll(/\*Guarded by:\*([\s\S]*?)(?=\n\d+\.\s|\n##|$)/g)) {
        for (const code of block[1].matchAll(/`([^`]+)`/g)) {
            for (const candidate of code[1].split(/[,\s]+/)) {
                const name = candidate.replace(/[^a-z0-9_]/gi, '');
                if (name.length > 12 && name.includes('_')) cited.add(name);
            }
        }
    }

    let missingTests = 0;
    for (const name of cited) {
        if (definedTests.has(name)) continue;
        missingTests += 1;
        problems.push(
            `docs/SECURITY_MODEL.md cites the test \`${name}\`, which does not exist in ` +
                `programs/commit-once/tests/`,
        );
    }
    console.log(
        `cited tests:    ${cited.size} checked (${definedTests.size} defined), ${missingTests} missing`,
    );
}

// ---------------------------------------------------------------------------------------
// 9. The website's numbers must be the same numbers EVIDENCE.md records.
//
// The site is the artifact a judge is most likely to read, and it quotes test counts, deploy
// slots and measured overhead. `EVIDENCE.md` is the authority on those. Nothing else compares
// the two, so a suite that grew or a redeployment would leave the site stating a number that is
// no longer true — and the site is the one place a reader has no way to check.
//
// Only values that appear in both are compared, and only where the site's phrasing is
// unambiguous.
// ---------------------------------------------------------------------------------------
const evidencePath = join(ROOT, 'EVIDENCE.md');
const sitePath = join(ROOT, 'apps', 'web', 'index.html');

if (existsSync(evidencePath) && existsSync(sitePath)) {
    const evidence = readFileSync(evidencePath, 'utf8');
    const site = readFileSync(sitePath, 'utf8');

    // The authoritative test totals, read from the recorded run output.
    const rustTotal = /TOTAL_PASSED=(\d+)/.exec(evidence)?.[1];
    const sdkTotal = /Tests\s+(\d+) passed/.exec(evidence)?.[1];

    if (rustTotal !== undefined) {
        const onSite = new RegExp(`\\b${rustTotal}\\s+passing`).test(site) ||
            new RegExp(`#\\s*${rustTotal}\\s+tests`).test(site);
        if (!onSite) {
            problems.push(
                `apps/web/index.html does not quote the Rust test total (${rustTotal}) that ` +
                    `EVIDENCE.md records`,
            );
        }
    }

    if (sdkTotal !== undefined) {
        const onSite = new RegExp(`\\b${sdkTotal}\\s+passing`).test(site);
        if (!onSite) {
            problems.push(
                `apps/web/index.html does not quote the SDK test total (${sdkTotal}) that ` +
                    `EVIDENCE.md records`,
            );
        }
    }

    // Every deploy slot EVIDENCE.md records for a program should appear on the site.
    const slots = [...evidence.matchAll(/Last Deployed In Slot:\s*(\d+)/g)].map((m) => m[1]);
    const uniqueSlots = [...new Set(slots)];
    let missingSlots = 0;
    for (const slot of uniqueSlots) {
        if (!site.includes(slot)) {
            missingSlots += 1;
            problems.push(
                `apps/web/index.html does not mention devnet deploy slot ${slot}, which ` +
                    `EVIDENCE.md records`,
            );
        }
    }
    console.log(
        `site numbers:   rust ${rustTotal ?? '?'}, sdk ${sdkTotal ?? '?'}, ` +
            `${uniqueSlots.length - missingSlots}/${uniqueSlots.length} deploy slots present`,
    );
}

// ---------------------------------------------------------------------------------------
// 10. Every evidence log must be referenced by at least one document, or it is dead weight
//     that nobody will ever find.
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
