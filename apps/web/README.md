# CommitOnce — product website

A self-contained static site for CommitOnce. **No build step, no dependencies, no framework, no
external requests.** Open `index.html` and it renders.

```text
apps/web/
├── index.html    the whole page — every fact is in the markup, not rendered by script
├── styles.css    design tokens + layout; system font stacks only, no webfonts
├── main.js       ~170 lines: the mechanism toggle and clipboard buttons
└── favicon.svg   a receipt glyph, inline SVG, no binary asset
```

## How to open it

**Directly from disk** — double-click `index.html`, or:

```powershell
start apps\web\index.html
```

The page is complete with JavaScript disabled. `main.js` only adds the guarded/unguarded toggle
in section 02 and the copy buttons; every number, table and claim is static HTML.

**Served over HTTP** (recommended if you want relative links to Markdown files to render in the
browser rather than download):

```bash
python -m http.server 8080 --directory apps/web
# or, from the repository root:
npx --yes serve apps/web
```

Hosting is a file copy: drop these four files on any static host. There is nothing to compile.

> **Note on the root workspace scripts.** The repository root declares `dev:web` and `build:web`
> as `pnpm --filter @commitonce/web …`, but this directory intentionally has no `package.json`,
> so those two scripts have no package to target and will fail. They are pre-existing and were
> left alone: adding a workspace package would invalidate `pnpm-lock.yaml`, and CI runs
> `pnpm install --frozen-lockfile`. A static site needs neither a dev server nor a build.

## Relative links

Links under “In the repository” and the `src` citation chips point at real files in this checkout
using relative paths (`../../README.md`, `../../docs/PRIOR_ART.md`, …). They work when the site is
served from inside the repository or opened from `apps/web/`.

They are **relative on purpose.** `package.json` names a GitHub repository, but
`https://api.github.com/repos/commitonce-dev/commitonce` returns **404** as of this writing, so a
GitHub link on the page would be a dead link — and `NEEDS_OWNER_ACTION.md` §5 says explicitly not
to put placeholder URLs in front of judges. If a public remote is created, replace the relative
paths in the footer with absolute URLs.

## Where every number comes from

`EVIDENCE.md` is the authority for this page. Each section carries a source chip linking to the
document and section it draws on. The mapping:

| On the page | Source |
| --- | --- |
| 40 Rust tests, exit 0; per-file counts 10/9/10/10/1 | `EVIDENCE.md` §4 |
| 48 SDK tests | `EVIDENCE.md` §5 |
| 4,067 / 13,904 / +9,837 CU; 273 / 677 / +404 bytes; 3 / 7 / +4 accounts | `EVIDENCE.md` §6 |
| 7,783 / 13,904 / 9,553 / 2,701 CU | `EVIDENCE.md` §6 |
| 202 bytes, 1,676,400 lamports, 0.0016764 SOL, 144 bytes, 4 accounts | `EVIDENCE.md` §6 |
| 5080 lamports/byte, stale crate 6960, “37% too high”, 128 + 276 byte decomposition, 200,000 CU budget, ~5% | `EVIDENCE.md` §6 |
| Program ids, deploy slots 501814672 / 501814798, upgrade authority | `EVIDENCE.md` §3 |
| Unaudited, mainnet not deployed, not on npm, no users, no integrations | `EVIDENCE.md` §7 |
| The “not verified” list | `EVIDENCE.md` §7 |
| Known limitations | `README.md` § Known limitations; `docs/SECURITY_MODEL.md` §7 |
| Mechanism, seeds, retention semantics, nonce policy | `docs/ARCHITECTURE.md` §2–§7; `docs/SECURITY_MODEL.md` §1–§6 |
| Prior art and the Light `nullifier-program` comparison | `docs/PRIOR_ART.md` §0, §4 |

**Two figures are not in `EVIDENCE.md`**, and are labelled on the page rather than smuggled in:

* the retention bounds “one hour to 365 days” — stated in `docs/ARCHITECTURE.md` §5 and
  `docs/SECURITY_MODEL.md` §6, not in `EVIDENCE.md`;
* `retention: '24h'` in the code sample — the SDK's documented default is 86,400 seconds
  (`DEFAULT_RETENTION_SECONDS` in `packages/sdk/src/instructions.ts`).

Everything else on the page is either a value from `EVIDENCE.md`, a structural fact from the
repository (e.g. Node 20.18.0 from `engines.node`), or clearly-labelled schematic notation
(`H₁`, `H₂`, `p`, `p′` in the hero panel are symbolic, not measurements).

## What the page deliberately does not contain

No testimonials, no logos, no “trusted by”, no user counts, no GitHub stars, no benchmarks other
than the measured ones, no waitlist, no roadmap promises. Those would all be fabrications: there
are no users and no integrations, and `EVIDENCE.md` §7 says so. The status strip above the fold
says “unaudited, devnet only, mainnet not deployed, not on npm, no users” because that is the
honest description of the product today, and because a technical buyer checks.

The guarantee is stated as **“at-most-once successful execution of a guarded logical intent
within the configured retention window”**. The string “exactly once” appears on the page only in
negations (“not exactly-once”, “not a claim of universal exactly-once execution”).

## Design direction

Stark Minimal, with Workstation-Dense data treatment. Near-black warm-neutral base (`#0b0c0e`,
never pure black), one accent (sodium amber) that doubles as the attention and limitation signal,
monospace for every number, address, hash and identifier, elevation from 1px hairlines and a
lighter background shade rather than drop shadows, no gradients and no illustration. Radius varies
by role (buttons 3px, panels 6px, code 8px, pills 999px). No scroll animations: motion exists only
to make a state change legible, and it is disabled under `prefers-reduced-motion`.

## Verified

Rendered in headless Chrome at **375px, 390px, 500px, 752px and 1424px** viewport widths, with the
layout measured from the live DOM:

* no horizontal overflow and no element crossing the viewport edge at any width;
* the hero collapses to one column below 900px and splits into two above it;
* the mechanism diagram defaults to the guarded path and the toggle works by click and by arrow
  key, updating `aria-pressed` and `display` correctly;
* contrast audited on 17 real text elements: worst ratio 5.74:1 (AA needs 4.5:1), zero failures;
* no interactive target under 24px tall, and footer links are ≥44px tall below 900px;
* all 7 copy buttons carry an accessible name;
* all 10 relative link targets resolve to files that exist in this checkout;
* no `lorem ipsum`, no `TODO`.
