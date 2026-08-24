# Theming and colour

Every colour in this app comes from a semantic token. Nothing hardcodes a
palette class, and there is a lint rule to keep it that way.

## Why this is a rule, not a preference

A workspace administrator picks the palette every member sees — Avarok Purple,
Nord, Dracula, Tokyo Night, Catppuccin, Solarized, Material Lighter/Darker,
Rosé Pine — and that choice is stored in the workspace's metadata and applied to
the document as CSS variables.

A class like `bg-purple-500` is not reachable by any of that. It renders purple
in a Nord workspace, green stays green in a red-accented theme, and the feature
looks half-implemented in exactly the places nobody re-checked. Hardcoding a
colour does not just skip theming — it *breaks* it, visibly, for every workspace
that chose something else.

The same applies to contrast. Token pairs are AA-verified in both light and dark
(`theme-foundation.test.ts` checks every text-on-fill pair across all nine
presets). A hardcoded colour has been checked by nobody.

## The tokens

Defined in `citadel-workspaces/src/index.css` for light (`:root`) and dark
(`.dark`), consumed through Tailwind.

| Token | Use it for |
|---|---|
| `background` / `foreground` | The page and its default text |
| `card` / `card-foreground` | Raised panels, dialogs, tiles |
| `popover` / `popover-foreground` | Floating surfaces — menus, tooltips, the ringing call card |
| `surface` / `surface-foreground` | Recessed or inset areas inside a card |
| `primary` / `primary-foreground` | Solid brand fills that carry text — the main button |
| `primary-accent` | Brand accents: icons, spinners, glows, focus rings, highlights |
| `secondary` / `secondary-foreground` | Quieter fills that still carry text |
| `muted` / `muted-foreground` | Backgrounds and text that should recede |
| `accent` / `accent-foreground` | Hover and selected states |
| `destructive` / `destructive-foreground` | Delete, leave, hang up, errors |
| `success` / `success-foreground` | Connected, delivered, online |
| `warning` / `warning-foreground` | Degraded, unstable, needs attention |
| `border`, `input`, `ring` | Lines, field surfaces, focus outlines |

Opacity works as normal: `bg-primary-accent/20`, `border-success/30`.

## Choosing one

Ask what the colour **means**, not what it looks like:

- A spinner is not "purple", it is a brand accent → `primary-accent`.
- A "connected" dot is not "green", it is success → `success`.
- A disabled hint is not "gray", it is receding text → `muted-foreground`.

If two tokens seem to fit, prefer the one whose `-foreground` pair you actually
need, because that pair is what has been contrast-checked.

## Colour must never be the only signal

WCAG 1.4.1. A speaking indicator pairs its accent ring with a glyph; a muted
participant shows a `MicOff` icon *and* screen-reader text. If removing colour
would remove the meaning, the state is not communicated yet.

## Adding a new colour

Don't, unless it is genuinely a new semantic role. If it is, add it to BOTH
`:root` and `.dark` in `index.css`, extend `ThemePalette` in
`src/lib/theme/theme-types.ts` so presets can set it, and add its text-on-fill
pair to the AA test. A token only present in one mode is worse than a hardcoded
colour, because it fails in exactly one theme.
