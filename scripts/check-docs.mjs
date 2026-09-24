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
 *   6. no orphaned row in a markdown table (a row whose neighbours were reflowed away)
 *   7. every test `docs/SECURITY_MODEL.md` cites as a guard actually exists
 *   8. the website's numbers are the numbers `EVIDENCE.md` records
 *   9. every evidence log is referenced by at least one document
 *  10. every document under `docs/` and `submission/` is reachable from somewhere
 *  11. the website's hosting contract (`.nojekyll` while it has repo-relative links)
 *  12. `prepare()` examples use the argument names the SDK actually accepts
 *  13. no script pins `HOME` to an absolute path without testing it exists first
 *  14. every anchor link (`#section`) resolves to a heading
 *
 * The list above is part of the check. It said "five" for most of this project's life while
 * the file implemented thirteen, which is the same drift this script exists to catch — in the
 * script itself. Adding a rule means adding a line here.
 *
 * Run: node scripts/check-docs.mjs
 */

import { execSync } from 'node:child_process';
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
        // The project switched to SBPFv3 and the switch missed ten places: the README, the
        // judge readme, the submission form, the project description, CONTRIBUTING, the
        // release runbook, ARCHITECTURE, the quickstart, EVIDENCE and verify.sh's own
        // default report. A reader of any of them would have built the artifact a real Agave
        // validator rejects. The historical narrative ("shipped SBPFv2 for most of its
        // life") is legitimate, so these patterns are written not to match it.
        pattern: /Flags: 0x2\b/,
        why: 'SBPFv3 is what ships; readelf -h reports Flags: 0x3',
    },
    {
        pattern: /SBPF_ARCH:-v2/,
        why: 'the build default is v3; SBPF_ARCH=v2 only reproduces the old artifact',
    },
    {
        pattern: /\(SBPFv2\)|SBPFv2 target|built for SBPFv2|for SBPFv2,|SBPFv2, `readelf/,
        why: 'SBPFv3 is what ships',
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
const CURRENT_COUNTS = new Set([60, 79]);
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
// 8. The website's numbers must be the same numbers EVIDENCE.md records.
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
// 9. Every evidence log must be referenced by at least one document, or it is dead weight
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
// 10. Every document under docs/ and submission/ must be reachable from somewhere.
//
// A document nothing links to is invisible in practice, however good it is. `submission/` had
// nine files in that state — including `TECHNICAL_OVERVIEW.md` and `PROJECT_DESCRIPTION.md` —
// and the README did not link `submission/JUDGE_README.md`, which is the entry point written
// for the person most likely to be reading. None of that is a content problem and all of it is
// a navigation one, which is why nothing caught it: every individual file was fine.
// ---------------------------------------------------------------------------------------
{
    const NAVIGABLE = /^(docs|submission)\/.*\.md$/;
    const candidates = files
        .map((f) => rel(f))
        .filter((p) => NAVIGABLE.test(p) && !p.endsWith('README.md'));

    // Every document's text, so a link can be found anywhere rather than only from the README.
    const corpus = new Map();
    for (const file of files) {
        if (!/\.(md|html)$/.test(rel(file))) continue;
        corpus.set(rel(file), readFileSync(file, 'utf8'));
    }

    let orphans = 0;
    for (const path of candidates) {
        const name = path.split('/').pop();
        const linked = [...corpus].some(
            ([other, text]) => other !== path && text.includes(name),
        );
        if (linked) continue;
        orphans += 1;
        problems.push(`${path}  is not linked from any document, so nothing will find it`);
    }
    console.log(`documents:      ${candidates.length} checked, ${orphans} unreachable`);

// ---------------------------------------------------------------------------------------
// 11. The website's hosting contract.
//
// `apps/web/index.html` links to 13 paths elsewhere in the tree, so it is not a self-contained
// bundle and it cannot be published from `apps/web` alone. That has a consequence for GitHub
// Pages: Jekyll rewrites `docs/API_REFERENCE.md` to `docs/API_REFERENCE.html`, so the page's
// link to the `.md` URL 404s unless a `.nojekyll` file is present at the published root.
//
// The two facts are coupled, so the check is conditional: **if the site still has repo-relative
// links, `.nojekyll` must exist.** Make the site self-contained and this rule stops applying,
// which is the right behaviour — the file is only there to serve those links.
// ---------------------------------------------------------------------------------------
{
    const site = readFileSync(join(ROOT, 'apps', 'web', 'index.html'), 'utf8');
    // Unique paths, not occurrences: the page links some assets twice (once as a `src`, once
    // as a `href` for the copy button), and the number the README quotes is the count of
    // distinct files it depends on.
    const repoRelative = [
        ...new Set([...site.matchAll(/(?:src|href)="(\.\.\/\.\.[^"]+)"/g)].map((m) => m[1])),
    ];

    if (repoRelative.length === 0) {
        console.log('site hosting:   self-contained, .nojekyll not required');
    } else {
        const hasNojekyll = existsSync(join(ROOT, '.nojekyll'));
        console.log(
            `site hosting:   ${repoRelative.length} repo-relative links, .nojekyll ${hasNojekyll ? 'present' : 'MISSING'}`,
        );
        if (!hasNojekyll) {
            problems.push(
                `apps/web/index.html links to ${repoRelative.length} paths elsewhere in the tree, ` +
                    'so publishing it needs .nojekyll at the root or those links 404 on GitHub Pages',
            );
        }
    }
}

// ---------------------------------------------------------------------------------------
// 12. prepare() examples in the documents must use the real field names.
//
// Three of them did not. README.md — the front page — passed { namespace, key, payload };
// packages/sdk/README.md passed payload instead of intent; submission/GTM.md passed key and
// omitted authority. All three were unrunnable, and the front-page one is the first code a
// reader meets.
//
// The failure was worse than a type error: prepare destructures authority and intent from the
// argument, so the missing fields arrived as undefined and the error surfaced as
// "intent contains undefined" — pointing at the payload when the real mistake was the
// argument shape.
//
// The rule reads only inside a prepare({ ... }) call, so prose that mentions the word "key"
// is untouched. The known names are taken from PrepareIntentArgs.
// ---------------------------------------------------------------------------------------
{
    const KNOWN = new Set([
        'authority',
        'namespace',
        'idempotencyKey',
        'intent',
        'retention',
        'refundDestination',
        'programAddress',
    ]);
    const REQUIRED = ['authority', 'namespace', 'idempotencyKey', 'intent'];

    const examplesFiles = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
        .split('\n')
        .filter((f) => /\.(md|html)$/.test(f))
        .filter((f) => !f.includes('WORK_LOG'));

    let examples = 0;
    let bad = 0;

    for (const rel of examplesFiles) {
        const body = readFileSync(join(ROOT, rel), 'utf8');

        // Bounded, so a runaway match cannot swallow a whole file.
        for (const match of body.matchAll(/prepare\(\{([\s\S]{0,400}?)\}\)/g)) {
            examples += 1;
            const args = match[1];
            const line = body.slice(0, match.index).split('\n').length;

            // Top-level keys only: the argument list is at one indent and the nested intent
            // payload is indented further, so the shallowest indent is the argument list.
            //
            // **Both spellings count.** `namespace: value` has a colon; `authority,` is ES6
            // shorthand for `authority: authority` and is what every example in this repository
            // actually uses. The first version matched only the colon form, so all three fixed
            // examples still reported "omits the required authority" — a check reading its own
            // blind spot as a defect in the document.
            //
            // `[ \t]` and not `\s`: `\s` matches the newline, so the first key in the list
            // started its match one character early and reported indent 3 while every other key
            // reported 2 — and the shallowest-indent filter then dropped it, making every
            // example look like it omitted `authority`.
            const keys = [...args.matchAll(/^[ \t]*([A-Za-z_$][\w$]*)[ \t]*(?::|,|$)/gm)].map((m) => ({
                name: m[1],
                indent: m[0].length - m[0].trimStart().length,
            }));
            if (keys.length === 0) continue;
            const shallowest = Math.min(...keys.map((k) => k.indent));
            const top = keys.filter((k) => k.indent === shallowest).map((k) => k.name);

            for (const name of top) {
                if (KNOWN.has(name)) continue;
                bad += 1;
                problems.push(
                    `${rel}:${line} prepare() uses ${name}, which is not an argument it accepts`,
                );
            }
            for (const name of REQUIRED) {
                if (top.includes(name)) continue;
                bad += 1;
                problems.push(`${rel}:${line} prepare() example omits the required ${name}`);
            }
        }
    }
    console.log(`${examples} prepare() examples checked, ${bad} problems`);
}

// ---------------------------------------------------------------------------------------
// 13. No script may pin HOME to an absolute path without checking it exists.
//
// `scripts/build.sh` and `scripts/test.sh` forced `HOME=/home/dell2u` and a WSL-specific PATH.
// That was correct on the machine they were written on and wrong everywhere else, and it
// **undid** `verify.sh`, which carefully checks whether that home exists before using it and
// then calls those scripts. A judge cloning the repository would have hit a confusing toolchain
// failure at the first step.
//
// A bare `export HOME=/abs/path` is the shape to refuse. `export HOME="$TOOLCHAIN_HOME"` inside
// an `if [ -d ... ]` is the shape to allow, which is what all three scripts now do.
// ---------------------------------------------------------------------------------------
{
    let pinned = 0;
    // **Every tracked text file**, not the three scripts.
    //
    // The first version named the scripts, and the same defect was sitting in two markdown
    // "Reproduce" blocks that a reader would copy verbatim — `EVIDENCE.md` and
    // `submission/DEMO_SCRIPT.md` each began a shell block with a bare
    // `export HOME=/home/dell2u`, which on anyone else's machine breaks their own shell.
    // Same hardcoded-scope failure as the version check, one round later.
    const pinnedFiles = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
        .split('\n')
        .filter((f) => /\.(md|html|sh|mjs|yml|yaml|toml|ts)$/.test(f))
        .filter((f) => !f.includes('WORK_LOG'));

    for (const rel of pinnedFiles) {
        const full = join(ROOT, rel);
        if (!existsSync(full)) continue;
        const body = readFileSync(full, 'utf8');
        for (const [i, line] of body.split('\n').entries()) {
            const match = /^\s*export HOME=(\/[^\s"\']+)/.exec(line);
            if (match === null) continue;

            // The guard has to be *earlier in the file*, which is what the scripts do:
            //
            //     if [ -d /home/dell2u/solana-current/bin ]; then
            //         export HOME=/home/dell2u
            //
            // Testing the path rather than tracking block depth keeps this simple, and it
            // catches the failure that actually happened: an unconditional pin, which by
            // definition has no earlier test of the path it pins.
            const lines = body.split('\n');
            const before = lines.slice(0, i).join('\n');

            // A `-d` test of the pinned path earlier in the file is the guard the scripts use.
            if (before.includes(`-d ${match[1]}`)) continue;

            // A **historical quote** is also fine. `CONTRIBUTING.md` shows the broken form it
            // is warning about — "`scripts/build.sh` and `scripts/test.sh` used to begin with:"
            // followed by the two lines — and a rule that cannot tell a warning from the thing
            // it warns about would force the warning to be deleted. The window is ten lines,
            // which reaches the introducing sentence but not unrelated prose, and the markers
            // are phrases this project actually uses to mean "this was true once".
            const window = lines.slice(Math.max(0, i - 10), i).join('\n');
            const historical = /used to|previously|no longer|before this|would have hit/i.test(window);
            if (historical) continue;

            pinned += 1;
            problems.push(
                `${rel}:${i + 1} pins HOME to ${match[1]} with no earlier -d test of that path, so it is forced on every machine: ${line.trim()}`,
            );
        }
    }
    console.log(`scripts:        ${pinned} unconditional HOME pins (want 0)`);
}
}

// ---------------------------------------------------------------------------------------
// 14. Every anchor link resolves to a heading.
//
// Rule 1 checks that a relative link points at a file that exists. It says nothing about the
// fragment on the end, so `[Costs](./FAQ.md#costs)` passes whether or not `FAQ.md` has a
// `## Costs` heading — and a link that lands at the top of a long document is nearly as
// annoying as one that 404s. **An anchor is a link too**, and the check described itself as
// covering links while silently skipping these.
//
// The anchor algorithm is GitHub's: lowercase, drop anything that is not a word character, a
// space or a hyphen, then turn spaces into hyphens. That is why "Timing, expiry and cleanup"
// becomes `#timing-expiry-and-cleanup` and not `#timing,-expiry-and-cleanup`.
// ---------------------------------------------------------------------------------------
{
    const anchorFor = (title) =>
        title
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-');

    const markdownFiles = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
        .split('\n')
        .filter((f) => /\.md$/.test(f));

    let anchorsChecked = 0;
    let anchorsBroken = 0;

    for (const rel of markdownFiles) {
        const raw = readFileSync(join(ROOT, rel), 'utf8');

        // **Strip code before looking for links.** A work-log entry that says "an anchor is
        // `](#section)`" is describing a link, not making one, and the first version of this
        // rule failed the work log that documented it. The same shape as the version rule
        // flagging its own comment and the HOME rule flagging the warning it warns about.
        const body = raw
            .replace(/```[\s\S]*?```/g, '')
            .replace(/`[^`\n]*`/g, '');

        // Every heading in this file, as anchors. Taken from the raw text, because a heading
        // can legitimately contain a code span.
        const here = new Set(
            [...raw.matchAll(/^#{1,6} (.+)$/gm)].map((m) => anchorFor(m[1].trim())),
        );

        // Same-file anchors: `](#section)`.
        for (const match of body.matchAll(/\]\(#([^)]+)\)/g)) {
            anchorsChecked += 1;
            if (here.has(match[1])) continue;
            anchorsBroken += 1;
            const line = body.slice(0, match.index).split('\n').length;
            problems.push(`${rel}:${line} links to #${match[1]}, which is not a heading in that file`);
        }

        // Cross-file anchors: `](./OTHER.md#section)`.
        // Any relative path, with or without a leading `./`. The first version required a dot,
        // so `docs/FAQ.md#section` — the form this repository actually uses — was skipped, and
        // the negative test that introduced a bad cross-file anchor did not fire.
        for (const match of body.matchAll(/\]\(([^):#\s][^)#\s]*)#([^)]+)\)/g)) {
            anchorsChecked += 1;
            const target = join(dirname(join(ROOT, rel)), match[1]);
            if (!existsSync(target)) continue; // rule 1 already reports this
            // Headings come from the raw text; see above for why links do not.
            const targetBody = readFileSync(target, 'utf8');
            const targetAnchors = new Set(
                [...targetBody.matchAll(/^#{1,6} (.+)$/gm)].map((m) => anchorFor(m[1].trim())),
            );
            if (targetAnchors.has(match[2])) continue;
            anchorsBroken += 1;
            const line = body.slice(0, match.index).split('\n').length;
            problems.push(`${rel}:${line} links to ${match[1]}#${match[2]}, which is not a heading there`);
        }
    }
    console.log(`anchors:        ${anchorsChecked} checked, ${anchorsBroken} broken`);
}

// ---------------------------------------------------------------------------------------
console.log(
    `\n${problems.length === 0 ? 'DOCS CHECK PASSED' : `DOCS CHECK FAILED (${problems.length})`}`,
);
for (const problem of problems) console.log(`  FAIL  ${problem}`);
process.exit(problems.length === 0 ? 0 : 1);
