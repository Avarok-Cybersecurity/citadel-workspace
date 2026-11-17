/**
 * Workspace theming — the type the whole feature is built on.
 *
 * ## Why HSL channels rather than hex strings
 *
 * The tokens in index.css are already `H S% L%` triples, because Tailwind
 * composes them with alpha (`hsl(var(--primary) / 0.06)`). Storing `{h,s,l}` as
 * numbers keeps that contract, lets the colour wheel manipulate one channel
 * without reparsing, and makes light->dark derivation arithmetic instead of
 * string surgery.
 *
 * ## Why this does not thread a theme object through components
 *
 * Components already reference semantic tokens (`bg-card`, `border-border`,
 * `text-primary`) rather than literal colours. That indirection IS the single
 * source of truth, and it already works. Applying a theme therefore means
 * writing these variables onto the document — not passing a theme prop through
 * several hundred components, which would create a second source of truth that
 * could disagree with the CSS.
 */

/** A colour as the CSS custom properties store it: `H S% L%`. */
export interface HslColor {
  /** 0-360 */
  h: number;
  /** 0-100 */
  s: number;
  /** 0-100 */
  l: number;
}

/**
 * Every colour token the product uses, one per role.
 *
 * The keys mirror the CSS variable names (`primaryForeground` <->
 * `--primary-foreground`) so the mapping stays mechanical and a token cannot be
 * added here without a matching variable.
 */
export interface ThemePalette {
  background: HslColor;
  foreground: HslColor;
  card: HslColor;
  cardForeground: HslColor;
  popover: HslColor;
  popoverForeground: HslColor;
  /** Elevated surface: menus, hover states, selected rows. */
  surface: HslColor;
  surfaceForeground: HslColor;

  /** Button fill. Must carry its foreground at AA. */
  primary: HslColor;
  primaryForeground: HslColor;
  /** The lighter brand tone used for accent text and icons. */
  primaryAccent: HslColor;

  secondary: HslColor;
  secondaryForeground: HslColor;
  muted: HslColor;
  mutedForeground: HslColor;
  accent: HslColor;
  accentForeground: HslColor;

  destructive: HslColor;
  destructiveForeground: HslColor;
  /**
   * Destructive as TEXT, which is a different requirement from destructive as a
   * FILL and cannot be the same colour. The fill has to be dark enough for white
   * `destructiveForeground` to sit on it; the text has to be light enough to be
   * read ON the background. In dark mode those pull opposite ways — text needs
   * L >= ~61%, white-on-fill needs L <= ~50% — so one value cannot serve both.
   * Exactly the gap `ensureTextContrast` was written for on primaryAccent.
   */
  destructiveEmphasis: HslColor;
  success: HslColor;
  successForeground: HslColor;
  warning: HslColor;
  warningForeground: HslColor;

  border: HslColor;
  input: HslColor;
  ring: HslColor;
  /**
   * The resting edge of a text field -- Input, Textarea, Select. At least 3:1 against every
   * surface a field sits on (WCAG 1.4.11); `input`, a fill, is not reused for it because it also
   * colours the sidebar. Derived from the accent hue, so it follows the scheme.
   */
  controlBorder: HslColor;
}

/** Token keys, derived from the type so the two cannot drift apart. */
export type ThemeTokenKey = keyof ThemePalette;

/**
 * How a workspace is represented in the switcher and the sidebar.
 *
 * `emoji` is optional: with none, the UI falls back to the workspace's initials
 * on `color`, which is what it does today.
 */
export interface WorkspaceIcon {
  emoji?: string;
  /** Background the emoji or initials sit on. */
  color: HslColor;
}

export interface WorkspaceTheme {
  id: string;
  name: string;
  /**
   * Presets ship with the product and cannot be edited or renamed in place —
   * editing one produces a copy. This is what makes "reset to Avarok Purple"
   * always possible.
   */
  isPreset: boolean;
  icon: WorkspaceIcon;
  /** Corner rounding in rem, written to `--radius`. */
  radius: number;
  light: ThemePalette;
  dark: ThemePalette;
  /**
   * True while `dark` is whatever deriveDarkPalette produced from `light`.
   *
   * Editing a dark colour by hand clears this, so a later light-side edit stops
   * silently overwriting the user's dark work. Without the flag we would have to
   * choose between never re-deriving (dark drifts out of step with light) and
   * always re-deriving (hand edits vanish).
   */
  darkIsDerived: boolean;
}

/** The two palettes a theme carries. Distinct from the user's light/dark/system preference. */
export type ThemeMode = 'light' | 'dark';
