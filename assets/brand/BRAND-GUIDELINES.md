# Citadel Workspace — brand guidelines

The mark is a monoline **W** whose rightmost stroke keeps going and becomes an
arrow. It inherits the round caps, the single-weight stroke and the rising
arrowhead of the Avarok **A** and the Atlas chevrons; it carries the workspace's
own purple rather than the Atlas four-colour sequence.

## Which lockup

- **`logo-full`** — mark + Citadel + Workspace. The default wherever the tagline
  has room to be read: 240 px wide and up on screen, 48 mm in print.
- **`logo-horizontal`** — mark + Citadel. Top bars, tight headers, anything
  narrower than 240 px. Minimum 130 px.
- **`wordmark`** — pages where the mark already appears elsewhere. Minimum 130 px.
- **`mark`** — every square context: avatars, favicons, app icons, tray.
  Minimum 20 px; below 48 px use `mark-compact`.

Pick the file that matches the background: the plain files on light grounds, the
`-ondark` files on dark. Don't recolour one into the other — the two purples are
different values, deliberately.

## Geometry

One path for the W, one for the shaft, one for the head. Round caps and joins
throughout.

| | |
| --- | --- |
| Stroke | 62 (production), 92 (compact cut) |
| Mark box | 834 × 766 |
| Vertices | left top (31, 175) · valley (200, 735) · apex (360, 275) · valley (520, 735) |
| Arrow tip | (732, 31) |
| Barbs | (594, 112) and (803, 175) — length 160, ±43° about the shaft |
| Shaft lean | 16.8° off vertical |
| Overshoot above the cap line | 144 units |

**The head is wide on purpose.** The barbs are symmetric about the shaft, at
±43° — well past the angle a drawing tool would default to. Narrower than about
40° and the inner barb runs alongside the shaft instead of away from it, and the
arrow reads as a hook. The 43° is the artwork; if you rebuild the mark in
another tool, measure it rather than eyeballing it.

## Clear space

One `x` on every side, where `x` is the arrow's rise above the W's cap line
(144 units). It is a feature of the mark itself, so it can be measured off the
artwork at any size and there is no ratio to remember. Nothing enters that
space: no type, no rules, no other logo, no edge of the page.

## Minimum sizes

| Asset | Screen | Print |
| --- | --- | --- |
| `logo-full` | 240 px wide | 48 mm |
| `logo-horizontal` | 130 px wide | 27 mm |
| `wordmark` | 130 px wide | 27 mm |
| `mark` | 20 px | 5 mm |

These are legibility limits, not preferences. Below 48 px the production stroke
renders as a smear, which is what `mark-compact` exists for: stroke 92 against
62, barbs 180 against 160, so the head stays open.

## Colour

Black, white and purple. Nothing else.

| Role | Hex | Contrast |
| --- | --- | --- |
| Ink on light | `#1C1D28` | 16.5:1 on white |
| Ink on dark | `#FFFFFF` | 16.5:1 on `#1C1D28` |
| Arrow on light | `#6E59A5` | 5.8:1 on white |
| Arrow on dark | `#9B87F5` | 5.6:1 on `#1C1D28` |
| Wordmark on light | `#1C1D28` | 16.5:1 |
| Wordmark on dark | `#FFFFFF` | 16.5:1 |
| Tagline on light | `#555766` | 7.0:1 on white |
| Tagline on dark | `#B5A6C9` | 7.3:1 on `#1C1D28` |

**The purple flips with the ground, for a measured reason.** `#6E59A5` clears
5.8:1 on white but only 2.9:1 on the app's own background — under the 3:1 floor
for a graphical object. On dark grounds the mark takes `#9B87F5` instead, which
is the app's `--primary-accent`. The inverse also holds: `#9B87F5` is 2.9:1 on
white, so it never goes on a light ground.

## Backgrounds

- Light ground: `#FFFFFF`. Off-whites to about `#F7F7FA` are fine.
- Dark ground: `#1C1D28` — the app's own `--background`, not pure black and not
  a brand-tinted dark.
- Mid-tones are the failure case. Anything between roughly `#6A6A78` and
  `#C8C8D2` loses either the ink or the tagline; put the logo on a solid panel.
- A workspace administrator picks any of nine palettes, so the logo never
  inherits a theme colour. It stays ink-and-purple on whichever surface the
  active theme paints.
- Photographs: a solid panel behind the logo, not a shadow or an outline.

## What not to do

- Don't scale the axes independently, tilt it, or set it on a curve.
- Don't recolour the arrow to a theme colour. The logo is fixed; the workspace
  palette is not.
- Don't put the light-ground cut on dark, or the dark-ground cut on light.
- Don't add shadows, glows, outlines, bevels or a gradient along the shaft.
- Don't narrow the head. Under about 40° the inner barb crowds the shaft.
- Don't box the mark in a circle or a rounded square — platforms crop it for
  you and the assets are cut for that crop.
- Don't set the wordmark in another face, or letterspace it to fill a box.
- Don't reuse the Atlas chevrons or its four-colour sequence next to this mark.
  Different product, different family.

## Square assets are sized for the crop, not the canvas

Discord and X mask to a circle; Android maskable icons crop to roughly the inner
80% by diameter. Every square asset places the mark at 65.5% of canvas width so
its furthest extremity — the outer barb of the arrowhead — clears that circle
with margin. `icon-maskable-512` drops to 48% for the Android safe zone, and
`apple-touch-icon-180` ships on a solid ground because iOS composites
transparency onto black.

## The tray icon

Ship `tray-template-*.png` as the default. macOS and Windows invert a
single-colour glyph to match the bar, and a purple arrow at 20 px is 1.5 px of
colour nobody can resolve. `tray-template-light-*.png` is for bars that do not
invert and are dark; `tray-color-*.png` is for Linux trays and for 32 px and up,
where the purple survives.

## The wordmark

"Citadel" is set at weight 500 with -2% tracking; "Workspace" at weight 400 with
+12% tracking, at 42% of the wordmark's size. The face is the app's own UI
stack — SF Pro Display, falling back through Helvetica Neue and Arial — which
means the SVG masters carry **live text**, not outlines: they render with real
SF Pro on Apple platforms and with the nearest available grotesque elsewhere.

If the wordmark needs to render identically everywhere (print, third-party
platforms, embedded PDFs), outline it from SF Pro Display once and replace the
`<text>` elements in `svg/wordmark.svg`, `svg/logo-horizontal.svg` and
`svg/logo-full.svg` with the resulting paths. The PNG exports in `light/`,
`dark/` and `transparent/` are already rasterised and are unaffected.

## Files and tokens

`tokens/` carries the palette as `brand.css` (custom properties with a
`prefers-color-scheme` block), `brand.scss`, `brand.json` and a Tailwind colour
fragment. Import from there rather than pasting hexes.

These are **logo** colours. The product's semantic tokens live in
`citadel-workspaces/src/index.css` and are consumed as `bg-primary`,
`text-primary-accent` and so on — don't duplicate one into the other.
