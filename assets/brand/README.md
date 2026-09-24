# Citadel Workspace brand kit

```
BRAND-GUIDELINES.md         the rules, in text
svg/                        vector masters — edit these
svg/spec/                   clear-space diagram
light/                      white ground
dark/                       #1C1D28 ground
transparent/                alpha channel
tray/                       system tray, template + colour cuts
tokens/                     palette as CSS, SCSS, JSON, Tailwind
site.webmanifest            PWA manifest, ready to drop in
head-snippet.html           the <head> block
favicon.ico                 16 / 32 / 48 bundled
```

The interactive guide is `Citadel Brand Guide.dc.html` at the project root.

## Colours

| Role | Hex |
| --- | --- |
| Ink on light | `#1C1D28` |
| Ink on dark | `#FFFFFF` |
| Arrow on light | `#6E59A5` |
| Arrow on dark | `#9B87F5` |
| Tagline on light | `#555766` |
| Tagline on dark | `#B5A6C9` |
| Light ground | `#FFFFFF` |
| Dark ground | `#1C1D28` |

The purple flips with the ground: `#6E59A5` is 2.9:1 on `#1C1D28` and `#9B87F5`
is 2.9:1 on white, so neither one works on both. Files carrying the dark-ground
values are suffixed `-ondark`.

## Dropping it into the app

The PWA's public directory maps onto this kit as follows.

| Kit file | `citadel-workspaces/public/` |
| --- | --- |
| `favicon.ico` | `favicon.ico` |
| `light/apple-touch-icon-180.png` | `icons/apple-touch-icon.png` |
| `light/icon-192.png` | `icons/icon-192.png` |
| `light/icon-512.png` | `icons/icon-512.png` |
| `light/icon-maskable-512.png` | `icons/icon-512-maskable.png` |
| `dark/og-image-1200x630.png` | `og-image.png` |

`site.webmanifest` here matches what `vite-plugin-pwa` injects; reconcile the
two rather than shipping both. `index.html`'s `theme-color` is already the
surface colour rather than the brand purple — leave it that way.

## Regenerating

Every PNG in this kit was rasterised from the geometry recorded in
`tokens/brand.json`. Change a vertex or a colour there and in the SVG masters
together; the exports are derived, never hand-edited.
