# CommitOnce brand assets

The mark is the product in one image: **a committed receipt in front, a rejected duplicate
behind it.** The front square is solid and carries a `1`; the square behind it is outline-only,
because that attempt never filled in.

```
        ┌──────────┐
   ┌────┊──────┐   │        back:  the duplicate — outline, 34% amber, never committed
   │    │  1   │   │        front: the receipt   — solid amber, holds the "1"
   │    └──────┘───┘
   └──────────────┘         1:      one execution
```

The `1` rather than a checkmark is deliberate. A check says "this succeeded", which every
product says; a `1` says *exactly one*, which is what this product actually guarantees.

## Files

| File | Use |
| --- | --- |
| `commitonce-mark.svg` | **The mark, 48px and up.** Background, duplicate, receipt. |
| `commitonce-mark-compact.svg` | **The mark, below 48px.** Background and receipt only — no duplicate. |
| `commitonce-mark-transparent.svg` | No background; the `1` is cut out with a mask, so it sits on any surface. |
| `commitonce-mark-{1024,512,256,128,64,48}.png` | Exports of the full mark. |
| `commitonce-mark-compact-{32,16}.png` | Exports of the compact mark. |
| `commitonce-mark-{1024,512}-transparent.png` | Exports of the transparent mark. |

**For the submission form:** `commitonce-mark-1024.png`, or `commitonce-mark-512.png` if the
form caps the size. Both are the full mark on the ink background, square, opaque.

## Palette

Taken from `apps/web/styles.css`, not chosen separately — `scripts/check-brand.mjs` fails if
the two ever disagree.

| Token | Value | Role |
| --- | --- | --- |
| `--ink` | `#0b0c0e` | Background; also the `1` in the full mark |
| `--accent` | `#e8a33d` | The receipt and the duplicate's outline |

No gradients, no shadows, no glows. The mark is flat geometry, matching the restraint of the
site. The only transparency is the duplicate's 34% opacity, which is what makes it read as
"behind" rather than "beside".

## Size thresholds — and an honest limitation

Two marks exist because one does not survive the whole range. **The split is at 48px.**

The duplicate's stroke is 16 user units at 34% opacity. At 32px that is about one pixel, and
antialiasing blends it to roughly `#100f0f` against the `#0b0c0e` background — a difference of
five levels out of 255, which is not visible. So the compact mark drops it rather than
thickening it and unbalancing the large sizes.

**The compact mark at 16px does not render a legible `1`.** At that size the `1`'s stroke is
about 1.2 pixels and it reads as a notch in an amber square, not as a numeral. This was checked
by rendering the mark and printing the raster as characters, not assumed:

```
   compact @ 32px              compact @ 16px
   .........++++++++........    ....:-----:.....
   .......:######++#####+...    ...-###-###:....
   .......+#####+..+#####+..    ...+##:.###-....
   .......#####+...+#####+..    ...+##+.###-....
   .......#+......+#####+...    ...+#+-.-+#-....
   .......######+..+#####+..    ...-##+-+##:....
   .......+###+--::--+###+..    ....-+++++:.....
   .......-##############...    ................
```

At 32px the `1` is legible. At 16px it is not, and no amount of tweaking a 16-pixel square will
change that. The 16px export is shipped because some legacy surfaces still request it, and it is
correct as a *shape* — an amber receipt on ink — but it should not be treated as carrying the
`1`. If a surface genuinely needs a legible 16px icon, use the mark without the numeral.

## Clear space and minimum sizes

* Keep clear space of at least **12% of the mark's width** on every side.
* Do not place the mark on a mid-tone background without the ink plate; use the transparent
  variant on light surfaces and the standard one on dark.
* Do not recolour, rotate, outline, or add effects.
* Do not put the mark inside another shape.

## Checking it

```bash
node scripts/check-brand.mjs
```

This is dependency-free. It reads the palette out of `apps/web/styles.css`, asserts every
colour in every brand SVG comes from that palette (or is a mask stencil), asserts the compact
mark still has no duplicate, asserts every exported PNG exists and is really a PNG, and asserts
`apps/web/index.html` points at `assets/brand/` rather than keeping a local copy that could
drift.

What it does **not** do is look at rendered pixels — that needs a rasterizer, which the project
does not depend on. The rendered geometry was verified once, by sampling and by printing the
raster, and the conclusions are the size table above.
