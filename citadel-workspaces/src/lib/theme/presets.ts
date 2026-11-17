import type { WorkspaceTheme, HslColor } from './theme-types';
import { buildPalette, type PaletteSeed } from './palette-builder';
import { AVAROK_LIGHT, AVAROK_DARK, AVAROK_RADIUS } from './preset-avarok';

/**
 * The themes that ship with the product.
 *
 * Avarok Purple is transcribed literally (see preset-avarok.ts). The rest are
 * built from seeds, so each is internally consistent and every foreground is
 * chosen for contrast rather than typed by hand.
 *
 * Each borrows the palette of a well-known editor theme. Both modes are seeded
 * explicitly rather than deriving one from the other: a light counterpart
 * derived from Dracula is a washed-out lilac, not a theme anyone would choose.
 * Derivation is the default for themes a USER makes, where there is nothing
 * better to start from.
 */

interface PresetSpec {
  id: string;
  name: string;
  icon: HslColor;
  light: PaletteSeed;
  dark: PaletteSeed;
  radius?: number;
}

const SPECS: PresetSpec[] = [
  {
    id: 'material-lighter',
    name: 'Material Lighter',
    icon: { h: 256, s: 90, l: 60 },
    light: {
      background: { h: 0, s: 0, l: 98 },
      primary: { h: 256, s: 90, l: 58 },
      primaryAccent: { h: 217, s: 45, l: 50 },
      foreground: { h: 199, s: 18, l: 33 },
    },
    dark: {
      background: { h: 0, s: 0, l: 15 },
      primary: { h: 256, s: 90, l: 65 },
      primaryAccent: { h: 174, s: 42, l: 65 },
    },
  },
  {
    id: 'material-darker',
    name: 'Material Darker',
    icon: { h: 174, s: 42, l: 56 },
    light: {
      background: { h: 0, s: 0, l: 97 },
      primary: { h: 174, s: 60, l: 34 },
      primaryAccent: { h: 199, s: 70, l: 40 },
    },
    dark: {
      background: { h: 0, s: 0, l: 13 },
      primary: { h: 174, s: 42, l: 50 },
      primaryAccent: { h: 174, s: 42, l: 66 },
      foreground: { h: 180, s: 100, l: 96 },
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    icon: { h: 193, s: 43, l: 67 },
    light: {
      background: { h: 218, s: 27, l: 94 },
      primary: { h: 213, s: 32, l: 45 },
      primaryAccent: { h: 193, s: 43, l: 42 },
      foreground: { h: 220, s: 16, l: 22 },
    },
    dark: {
      background: { h: 220, s: 16, l: 22 },
      primary: { h: 213, s: 32, l: 52 },
      primaryAccent: { h: 193, s: 43, l: 67 },
      foreground: { h: 218, s: 27, l: 92 },
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    icon: { h: 265, s: 89, l: 78 },
    light: {
      background: { h: 60, s: 30, l: 96 },
      primary: { h: 265, s: 50, l: 50 },
      primaryAccent: { h: 326, s: 60, l: 48 },
    },
    dark: {
      background: { h: 231, s: 15, l: 18 },
      primary: { h: 265, s: 60, l: 60 },
      primaryAccent: { h: 326, s: 100, l: 74 },
      foreground: { h: 60, s: 30, l: 96 },
      success: { h: 135, s: 94, l: 65 },
      warning: { h: 65, s: 92, l: 76 },
    },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    icon: { h: 221, s: 87, l: 73 },
    light: {
      background: { h: 220, s: 43, l: 96 },
      primary: { h: 221, s: 60, l: 48 },
      primaryAccent: { h: 261, s: 50, l: 50 },
    },
    dark: {
      background: { h: 235, s: 19, l: 13 },
      primary: { h: 221, s: 60, l: 58 },
      primaryAccent: { h: 261, s: 84, l: 78 },
      foreground: { h: 229, s: 35, l: 82 },
    },
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    icon: { h: 267, s: 84, l: 81 },
    light: {
      background: { h: 220, s: 100, l: 98 },
      primary: { h: 267, s: 50, l: 52 },
      primaryAccent: { h: 217, s: 60, l: 50 },
    },
    dark: {
      background: { h: 240, s: 21, l: 15 },
      primary: { h: 267, s: 60, l: 62 },
      primaryAccent: { h: 217, s: 92, l: 76 },
      foreground: { h: 226, s: 64, l: 88 },
    },
  },
  {
    id: 'solarized',
    name: 'Solarized',
    icon: { h: 205, s: 69, l: 49 },
    light: {
      background: { h: 44, s: 87, l: 94 },
      primary: { h: 205, s: 69, l: 42 },
      primaryAccent: { h: 175, s: 59, l: 34 },
      // base01, not base00: base00 is Solarized's comment tone and gives ~4.0:1
      // on the light base3 background, under AA for body text.
      foreground: { h: 194, s: 25, l: 30 },
    },
    dark: {
      background: { h: 192, s: 100, l: 11 },
      primary: { h: 205, s: 69, l: 49 },
      primaryAccent: { h: 175, s: 59, l: 45 },
      foreground: { h: 186, s: 8, l: 65 },
    },
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    icon: { h: 2, s: 55, l: 83 },
    light: {
      background: { h: 32, s: 57, l: 95 },
      primary: { h: 267, s: 40, l: 48 },
      primaryAccent: { h: 2, s: 55, l: 48 },
      foreground: { h: 248, s: 19, l: 40 },
    },
    dark: {
      background: { h: 249, s: 22, l: 12 },
      primary: { h: 267, s: 57, l: 62 },
      primaryAccent: { h: 2, s: 55, l: 83 },
      foreground: { h: 245, s: 50, l: 91 },
    },
  },
];

/** Avarok Purple is first: it is the default, and the list is the order shown. */
export const PRESET_THEMES: WorkspaceTheme[] = [
  {
    id: 'avarok-purple',
    name: 'Avarok Purple',
    isPreset: true,
    icon: { color: { h: 257, s: 45, l: 45 } },
    radius: AVAROK_RADIUS,
    light: AVAROK_LIGHT,
    dark: AVAROK_DARK,
    darkIsDerived: false,
  },
  ...SPECS.map(
    (spec): WorkspaceTheme => ({
      id: spec.id,
      name: spec.name,
      isPreset: true,
      icon: { color: spec.icon },
      radius: spec.radius ?? AVAROK_RADIUS,
      light: buildPalette(spec.light, 'light'),
      dark: buildPalette(spec.dark, 'dark'),
      darkIsDerived: false,
    }),
  ),
];

export const DEFAULT_THEME_ID: "avarok-purple" = 'avarok-purple';

/** The theme applied when a workspace has never chosen one. */
export function defaultTheme(): WorkspaceTheme {
  const found: WorkspaceTheme | undefined = PRESET_THEMES.find((t) => t.id === DEFAULT_THEME_ID);
  if (!found) {
    // Unreachable unless the default is renamed without updating the id — worth
    // failing loudly, since the alternative is an unstyled app.
    throw new Error(`Default theme "${DEFAULT_THEME_ID}" is missing from PRESET_THEMES`);
  }
  return found;
}

export function findPreset(id: string): WorkspaceTheme | undefined {
  return PRESET_THEMES.find((t) => t.id === id);
}
