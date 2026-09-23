/**
 * Encoding check across every tracked text file.
 *
 * This exists because it caught a real defect. `scripts/check-docs.mjs` contained three
 * truncated em-dashes — the bytes `E2 80 3F`, which are the first two bytes of U+2014 followed
 * by a literal `?`. The file was not valid UTF-8, a strict decoder saw a replacement character,
 * and any tool that re-encoded it would have silently rewritten the comment. Nothing else in
 * the repository noticed: it is a `.mjs` file, so it is not covered by the markdown link check,
 * and it still ran correctly because Node's decoder is lenient.
 *
 * Two distinct failures are checked, and they need different detection:
 *
 *   1. **Not valid UTF-8 at all** — UTF-16, latin-1, or a truncated sequence like the one
 *      above. Caught by decoding with `fatal: true`.
 *   2. **Valid UTF-8 describing garbage** — mojibake, where the bytes of one character were
 *      previously decoded as latin-1 or GBK and re-encoded. This is *valid* UTF-8, so an
 *      encoding validator alone cannot see it. The tell is the character runs that those
 *      misreadings produce.
 *
 * Binary files are skipped by content (a NUL byte) rather than by extension, so a new binary
 * format does not produce a false failure.
 *
 * Run: node scripts/check-encoding.mjs
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

/**
 * Sequences that only appear when UTF-8 bytes were decoded as GBK or latin-1 and re-encoded.
 * The em-dash case is written as a codepoint rather than the literal, because a literal would
 * make this file match its own check.
 */
const MOJIBAKE = [
    ['\u9225', 'a UTF-8 em-dash misread as GBK'],
    ['\u00e2\u20ac', 'a UTF-8 dash or quote misread as latin-1'],
    ['\u00c3\u00a9', 'a UTF-8 e-acute misread as latin-1'],
    ['\ufffd', 'the Unicode replacement character'],
];

const problems = [];
let checked = 0;
let skippedBinary = 0;

/**
 * True when the NUL bytes are concentrated at every other offset, which is what UTF-16 text
 * looks like when read as bytes.
 *
 * This matters because the naive binary test — "contains a NUL, therefore binary" — silently
 * skips UTF-16, and a UTF-16 file is exactly the defect this repository has hit before: an
 * evidence log was once written by a Windows PowerShell redirect as UTF-16LE, which made it
 * unreadable on Linux and binary to git. A negative test caught that the first version of this
 * script skipped right past it.
 */
function looksLikeUtf16(bytes) {
    let evenNuls = 0;
    let oddNuls = 0;
    for (let i = 0; i < bytes.length; i += 1) {
        if (bytes[i] !== 0) continue;
        if (i % 2 === 0) evenNuls += 1;
        else oddNuls += 1;
    }
    const total = evenNuls + oddNuls;
    if (total < 4) return false;
    const dominant = Math.max(evenNuls, oddNuls);
    return dominant / total >= 0.9;
}

for (const file of tracked) {
    const bytes = readFileSync(join(ROOT, file));

    // A UTF-16 BOM is unambiguous, and must be caught before any binary skip.
    const utf16Bom =
        bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff));
    if (utf16Bom) {
        problems.push(`${file}  is UTF-16 (byte-order mark present), not UTF-8`);
        continue;
    }

    // Binary files have no encoding to check — but only after ruling out UTF-16, which also
    // contains NUL bytes.
    if (bytes.includes(0)) {
        if (looksLikeUtf16(bytes)) {
            problems.push(`${file}  looks like UTF-16 without a BOM (NUL bytes at every other offset)`);
        } else {
            skippedBinary += 1;
        }
        continue;
    }
    checked += 1;

    let text;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        problems.push(`${file}  is not valid UTF-8 (truncated or mis-encoded sequence)`);
        continue;
    }

    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        problems.push(`${file}  starts with a UTF-8 BOM`);
    }

    for (const [needle, label] of MOJIBAKE) {
        const at = text.indexOf(needle);
        if (at === -1) continue;
        const line = text.slice(0, at).split('\n').length;
        problems.push(`${file}:${line}  contains ${label}`);
        break;
    }
}

console.log(`encoding: ${checked} text files checked, ${skippedBinary} binary files skipped`);

console.log(`\n${problems.length === 0 ? 'ENCODING CHECK PASSED' : `ENCODING CHECK FAILED (${problems.length})`}`);
for (const problem of problems) console.log(`  FAIL  ${problem}`);
process.exit(problems.length === 0 ? 0 : 1);
