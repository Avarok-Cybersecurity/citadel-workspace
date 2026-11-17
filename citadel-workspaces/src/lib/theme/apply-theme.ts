import type { WorkspaceTheme, ThemePalette, ThemeMode, ThemeTokenKey } from './theme-types';
import { toCssValue } from './hsl';
import { syncThemeColorMeta } from './theme-color-meta';

/**
 * Writing a theme onto the document.
 *
 * Components reference semantic tokens (`bg-card`, `text-primary`), never a
 * literal colour, so setting these variables restyles the entire app with no
 * component changes. That indirection is the single source of truth for colour;
 * this module is the only writer.
 */

/** `primaryForeground` -> `--primary-foreground`. */
export function cssVarName(token: ThemeTokenKey): string {
  return `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** The full variable set for one palette, as a plain object for testing. */
export function paletteToCssVars(palette: ThemePalette): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [token, color] of Object.entries(palette)) {
    vars[cssVarName(token as ThemeTokenKey)] = toCssValue(color);
  }
  return vars;
}

/**
 * Apply `theme` in `mode` to `target` (the document root by default).
 *
 * Only the variables are written — the `.dark` class stays under next-themes'
 * control, because the user's light/dark/system preference is theirs and is
 * deliberately separate from the workspace's theme.
 */
export function applyTheme(
  theme: WorkspaceTheme,
  mode: ThemeMode,
  target: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
): void {
  if (!target) return;

  const palette: ThemePalette = mode === 'dark' ? theme.dark : theme.light;
  for (const [name, value] of Object.entries(paletteToCssVars(palette))) {
    target.style.setProperty(name, value);
  }
  target.style.setProperty('--radius', `${theme.radius}rem`);

  // The OS titlebar is part of the theme's surface even though the app does not
  // paint it.
  syncThemeColorMeta(target);
}

/**
 * Remove every variable this module sets, falling back to the stylesheet.
 *
 * Needed when leaving a workspace: without it the previous workspace's theme
 * would persist over the next one until it happened to set the same tokens.
 */
export function clearTheme(
  target: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
): void {
  if (!target) return;

  // Any palette gives the key set; the values are irrelevant to removal.
  for (const name of Object.keys(paletteToCssVars(EMPTY_PALETTE_SHAPE))) {
    target.style.removeProperty(name);
  }
  target.style.removeProperty('--radius');

  // Back to whatever the stylesheet says, rather than leaving the departed
  // workspace's colour on the titlebar.
  syncThemeColorMeta(target);
}

/**
 * A palette used only for its KEYS, so clearTheme cannot fall out of step with
 * the type — adding a token to ThemePalette is a compile error here until it is
 * listed.
 */
const ZERO: { h: number; s: number; l: number; } = { h: 0, s: 0, l: 0 };
const EMPTY_PALETTE_SHAPE: ThemePalette = {
  background: ZERO, foreground: ZERO, card: ZERO, cardForeground: ZERO,
  popover: ZERO, popoverForeground: ZERO, surface: ZERO, surfaceForeground: ZERO,
  primary: ZERO, primaryForeground: ZERO, primaryAccent: ZERO,
  secondary: ZERO, secondaryForeground: ZERO, muted: ZERO, mutedForeground: ZERO,
  accent: ZERO, accentForeground: ZERO,
  destructive: ZERO, destructiveForeground: ZERO, destructiveEmphasis: ZERO,
  success: ZERO, successForeground: ZERO,
  warning: ZERO, warningForeground: ZERO,
  border: ZERO, input: ZERO, ring: ZERO, controlBorder: ZERO,
};
