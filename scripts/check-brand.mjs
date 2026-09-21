/**
 * Brand consistency check.
 *
 * The mark exists in three SVG files and nine PNGs, and the site's favicon points at them. The
 * failure this guards against is drift: someone edits `--accent` in the stylesheet, or nudges
 * the mark's amber by hand, and the logo quietly stops matching the product it belongs to.
 *
 * It is deliberately dependency-free — no rasterizer, no image library. It checks the SVG
 * *source* (palette, structure, geometry) and the presence of the exported PNGs. What it does
 * not do is look at the rendered pixels; that was done once, by hand, with a sampler, and the
 * results are recorded in `assets/brand/README.md`.
 *
 * Run: node scripts/check-brand.mjs
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BRAND = join(ROOT, 'assets', 'brand');

const problems = [];
const notes = [];

function fail(message) {
    problems.push(message);
}

function ok(label, detail) {
    console.log(`  ok    ${label}${detail ? `  — ${detail}` : ''}`);
}

// ---------------------------------------------------------------------------------------
// 1. The palette the mark is allowed to use comes from the stylesheet, not from the SVG.
// ---------------------------------------------------------------------------------------
const css = readFileSync(join(ROOT, 'apps', 'web', 'styles.css'), 'utf8');
const token = (name) => {
    const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
    if (match === null) {
        fail(`apps/web/styles.css does not define --${name}`);
        return null;
    }
    return match[1].toLowerCase();
};

const ink = token('ink');
const accent = token('accent');
console.log(`site tokens: --ink ${ink}  --accent ${accent}\n`);

// ---------------------------------------------------------------------------------------
// 2. Every colour in every brand SVG must be one of the site's tokens, or pure white/black
//    inside a mask (where the colour is a stencil, not a brand colour).
// ---------------------------------------------------------------------------------------
const SVGS = [
    'commitonce-mark.svg',
    'commitonce-mark-compact.svg',
    'commitonce-mark-transparent.svg',
];

const allowed = new Set([ink, accent, '#ffffff', '#000000']);

/** `#abc` and `#aabbcc` are the same colour; compare them in one form. */
function normaliseHex(hex) {
    const value = hex.toLowerCase();
    if (value.length === 4) {
        return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
    }
    return value;
}

/** Comments are prose. A hex written in a comment is documentation, not a colour. */
function stripComments(source) {
    return source.replace(/<!--[\s\S]*?-->/g, '');
}

console.log('palette:');
for (const file of SVGS) {
    const source = stripComments(readFileSync(join(BRAND, file), 'utf8'));
    const colours = new Set(
        [...source.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map((m) => normaliseHex(m[0])),
    );
    const strays = [...colours].filter((c) => !allowed.has(c));
    if (strays.length > 0) {
        fail(`${file} uses colours outside the site palette: ${strays.join(', ')}`);
    } else {
        ok(file, [...colours].join(' '));
    }
}

// ---------------------------------------------------------------------------------------
// 3. Structure. The full mark is background + ghost + receipt; the compact mark has no ghost,
//    which is the whole reason it exists. If someone adds one back, this fails.
// ---------------------------------------------------------------------------------------
console.log('\nstructure:');
const countRects = (file) =>
    [...readFileSync(join(BRAND, file), 'utf8').matchAll(/<rect\b/g)].length;

const fullRects = countRects('commitonce-mark.svg');
const compactRects = countRects('commitonce-mark-compact.svg');
const transparentRects = countRects('commitonce-mark-transparent.svg');

if (fullRects !== 3) {
    fail(`commitonce-mark.svg has ${fullRects} rects, expected 3 (background, ghost, receipt)`);
} else {
    ok('full mark has background + ghost + receipt');
}

if (compactRects !== 2) {
    fail(
        `commitonce-mark-compact.svg has ${compactRects} rects, expected 2 (background, receipt). ` +
            `The compact mark must NOT carry the ghost: at 32px its stroke is about one pixel ` +
            `and it disappears into the background anyway.`,
    );
} else {
    ok('compact mark has background + receipt, no ghost');
}

if (transparentRects !== 3) {
    fail(
        `commitonce-mark-transparent.svg has ${transparentRects} rects, expected 3 ` +
            `(mask stencil, ghost, receipt)`,
    );
} else {
    ok('transparent mark has mask stencil + ghost + receipt');
}

// The stencil rect must live inside the mask. If it escaped, it would paint a white square
// over the mark.
const transparentBody = stripComments(
    readFileSync(join(BRAND, 'commitonce-mark-transparent.svg'), 'utf8'),
);
const maskBlock = /<mask[\s\S]*?<\/mask>/.exec(transparentBody)?.[0] ?? '';
if (!maskBlock.includes('<rect')) {
    fail('commitonce-mark-transparent.svg: the mask does not contain its stencil rect');
} else {
    const rectsOutsideMask = [...transparentBody.replace(maskBlock, '').matchAll(/<rect\b/g)].length;
    if (rectsOutsideMask !== 2) {
        fail(
            `commitonce-mark-transparent.svg has ${rectsOutsideMask} rects outside the mask, ` +
                `expected 2 (ghost, receipt)`,
        );
    } else {
        ok('only the ghost and receipt render outside the mask');
    }
}

// ---------------------------------------------------------------------------------------
// 4. The transparent mark must cut the "1" with a mask, not paint it in ink. An ink stroke
//    would only be correct on one background colour.
// ---------------------------------------------------------------------------------------
console.log('\nmask:');
const transparentSource = readFileSync(join(BRAND, 'commitonce-mark-transparent.svg'), 'utf8');
if (!transparentSource.includes('<mask') || !transparentSource.includes('mask="url(#cut)"')) {
    fail('commitonce-mark-transparent.svg must cut the "1" with a mask, not an ink-coloured stroke');
} else {
    ok('transparent mark cuts the "1" with a mask');
}

// ---------------------------------------------------------------------------------------
// 5. Every exported PNG exists and is a real PNG.
// ---------------------------------------------------------------------------------------
console.log('\nexports:');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXPECTED_PNGS = [
    'commitonce-mark-1024.png',
    'commitonce-mark-512.png',
    'commitonce-mark-256.png',
    'commitonce-mark-128.png',
    'commitonce-mark-64.png',
    'commitonce-mark-48.png',
    'commitonce-mark-compact-32.png',
    'commitonce-mark-compact-16.png',
    'commitonce-mark-1024-transparent.png',
    'commitonce-mark-512-transparent.png',
];

for (const file of EXPECTED_PNGS) {
    const path = join(BRAND, file);
    if (!existsSync(path)) {
        fail(`missing export: assets/brand/${file}`);
        continue;
    }
    const head = readFileSync(path).subarray(0, 8);
    if (!head.equals(PNG_MAGIC)) {
        fail(`assets/brand/${file} is not a PNG`);
        continue;
    }
    ok(file, `${statSync(path).size} bytes`);
}

// ---------------------------------------------------------------------------------------
// 6. The site must reference the brand assets, not a local copy, or the two will drift.
// ---------------------------------------------------------------------------------------
console.log('\nsite wiring:');
const html = readFileSync(join(ROOT, 'apps', 'web', 'index.html'), 'utf8');
const iconLinks = [...html.matchAll(/<link[^>]+rel="(?:icon|apple-touch-icon)"[^>]*>/g)].map(
    (m) => m[0],
);
if (iconLinks.length === 0) {
    fail('apps/web/index.html declares no icon');
} else {
    for (const link of iconLinks) {
        if (!link.includes('../../assets/brand/')) {
            fail(`index.html icon does not point at assets/brand/: ${link}`);
        }
    }
    if (iconLinks.every((l) => l.includes('../../assets/brand/'))) {
        ok(`${iconLinks.length} icon links point at assets/brand/`);
    }
}

for (const stale of ['favicon.svg', 'favicon-32.png']) {
    if (existsSync(join(ROOT, 'apps', 'web', stale))) {
        fail(`apps/web/${stale} still exists; the brand assets are the single source of truth`);
    }
}

// ---------------------------------------------------------------------------------------
// 7. Every referenced asset must resolve on disk.
// ---------------------------------------------------------------------------------------
console.log('\nreferences:');
let resolved = 0;
for (const match of html.matchAll(/(?:href|src)="(\.\.\/\.\.\/assets\/[^"]+)"/g)) {
    const target = join(ROOT, 'apps', 'web', match[1]);
    if (!existsSync(target)) {
        fail(`index.html references ${match[1]}, which does not exist`);
    } else {
        resolved += 1;
    }
}
ok(`${resolved} asset references resolve`);

// ---------------------------------------------------------------------------------------
console.log(
    `\n${problems.length === 0 ? 'BRAND CHECK PASSED' : `BRAND CHECK FAILED (${problems.length})`}`,
);
for (const problem of problems) {
    console.log(`  FAIL  ${problem}`);
}
for (const note of notes) {
    console.log(`  note  ${note}`);
}
process.exit(problems.length === 0 ? 0 : 1);
