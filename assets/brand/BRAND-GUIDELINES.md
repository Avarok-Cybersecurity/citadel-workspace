# Citadel Workspaces — brand guidelines

## The mark

A C drawn as one round-capped stroke. It runs clockwise from the lower right, up round the left side to the top, then levels off and becomes a purple arrow pointing right. The C is ink; only the arrow (shaft and head) is purple.

Geometry, in a 200-unit grid: circle centre (100, 100), radius 60, stroke 14. The arc starts 45° below horizontal on the right. The arrow runs along y = 40 from x = 100 to 162; barbs are 16 units back and 16 units up/down from the tip. Mark box: x 33–169, y 17–167.

## Lockups

- **logo-horizontal**: mark + "Citadel Workspaces". Default. Min 120 px wide.
- **logo-stacked**: mark centred over the name. Square and splash contexts. Min 96 px wide.
- **wordmark**: the mark stands in as the C of "Citadel Workspaces". Use where the mark isn't shown separately. Min 96 px wide.
- **mark**: square contexts. Min 16 px; use **mark-compact** (stroke 22) below 32 px.

Every lockup ships as plain (light ground), `-ondark`, `-black` and `-white`.

## Type

Geist Medium (500), tracking −1%. Open Font License, so it can be embedded and outlined freely. SF Pro's licence does not allow use in a logo, which is why the wordmark isn't set in it. All SVG masters have the text outlined; no font is needed to render them.

## Colour

| Role | Light ground | Dark ground |
| --- | --- | --- |
| Ink | #1C1D28 | #FFFFFF |
| Arrow | #6E59A5 | #9B87F5 |
| Ground | #FFFFFF | #1C1D28 |

#6E59A5 is 2.9:1 on #1C1D28, below the 3:1 minimum for graphics, so dark grounds use #9B87F5 (the app's --primary-accent). One-colour black and white versions are for print, embossing, and photography.

## Clear space

One x on every side, where x is the height of the arrowhead (46 units in the 200 grid).

## Don't

- Recolour the C purple, or the arrow to a theme colour.
- Rotate, flip or stretch it. The arrow always points right.
- Use the light-ground file on dark, or the reverse.
- Add shadows, glows, outlines or gradients.
- Put it inside another shape; platforms crop for you.
- Retype the wordmark in another font.

## App icons and crops

Square assets place the mark at 56% of the canvas height, which keeps it inside the circle crops used by Discord, X and Slack. The maskable icon uses 46% for Android's safe zone. Dark versions are the default app icon; light versions are provided.

## Tray

Ship `tray-template-*` on macOS (the system tints it). Windows: `tray-windows.ico` (white C, purple arrow for the dark taskbar). Linux: `tray-color-*` or `tray-color-ondark-*` to match the panel.
