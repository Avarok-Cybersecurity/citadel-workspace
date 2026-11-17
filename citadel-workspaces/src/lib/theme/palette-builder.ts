import type { HslColor, ThemePalette, ThemeMode } from './theme-types';
import { lighten, darken, readableForeground, contrastRatio } from './hsl';

/**
 * Building a full 26-token palette from a handful of seed colours.
 *
 * Authoring eight presets by hand would mean 8 x 2 x 26 = 416 values, which is
 * both tedious and the reason hand-made palettes drift: nothing forces `card`
 * and `popover` to relate to `background` the same way in every theme.
 *
 * A seed names only what actually distinguishes one theme from another — its
 * base surface, its brand colour, its accent. Everything else is derived by the
 * rules below, so every preset is internally consistent by construction, and a
 * foreground is never darker than the surface it sits on.
 */

export interface PaletteSeed {
  /** Deepest surface. Everything else is placed relative to it. */
  background: HslColor;
  /** Brand fill, used for primary buttons and the focus ring. */
  primary: HslColor;
  /** Brighter brand tone for accent text and icons. */
  primaryAccent: HslColor;
  /** Optional overrides where a theme's identity depends on them. */
  destructive?: HslColor;
  success?: HslColor;
  warning?: HslColor;
  /** Explicit body text colour, when the automatic choice is not the theme's. */
  foreground?: HslColor;
}

/** Status colours are shared unless a theme overrides them; they mean the same thing everywhere. */
const DEFAULT_STATUS: Record<ThemeMode, { destructive: HslColor; success: HslColor; warning: HslColor }> = {
  light: {
    destructive: { h: 0, s: 72, l: 45 },
    success: { h: 160, s: 84, l: 28 },
    warning: { h: 38, s: 92, l: 38 },
  },
  dark: {
    destructive: { h: 0, s: 84, l: 60 },
    success: { h: 160, s: 84, l: 39 },
    warning: { h: 38, s: 92, l: 50 },
  },
};

/**
 * How far each surface sits from the background, in lightness points.
 *
 * Light themes stack upward (cards are lighter than the page) and dark themes
 * stack the same way (cards are lighter than the page) — elevation reads as
 * "closer to the light" in both, which is why the dark steps are not simply the
 * light ones negated.
 */
const ELEVATION: Record<ThemeMode, { card: number; surface: number; accent: number; border: number; input: number }> = {
  light: { card: -1, surface: -4, accent: -6, border: -12, input: -3 },
  dark: { card: 4, surface: 9, accent: 9, border: 10, input: -3 },
};


/**
 * Nudge a FILL colour until its label clears `min` contrast.
 *
 * Choosing the better of black/white is not enough: a brand colour sitting near
 * 55% lightness gives roughly 4.2:1 against white, just under AA, which is where
 * six of the generated presets landed. Rather than hand-tweaking each seed — and
 * silently regressing the next one added — the builder moves the fill's
 * lightness away from its label until the ratio holds.
 *
 * Hue and saturation are untouched, so the theme's identity survives; a few
 * points of lightness on a button fill is imperceptible next to unreadable text.
 */
import { ensureFillContrast, ensureTextContrast, controlBorderFor } from './palette-contrast';

export function buildPalette(seed: PaletteSeed, mode: ThemeMode): ThemePalette {
  const { background, primary, primaryAccent } = seed;
  const step: { card: number; surface: number; accent: number; border: number; input: number; } = ELEVATION[mode];
  const status: { destructive: HslColor; success: HslColor; warning: HslColor; } = DEFAULT_STATUS[mode];

  const rawCard: HslColor = lighten(background, step.card);
  const rawSurface: HslColor = lighten(background, step.surface);
  const rawAccent: HslColor = lighten(background, step.accent);
  const border: HslColor = lighten(background, step.border);
  const input: HslColor = lighten(background, step.input);

  // Chosen for contrast rather than asked for, which is the commonest way a
  // hand-made theme becomes unreadable.
  const foreground: HslColor = seed.foreground ?? readableForeground(background);

  // The neutral fills carry body text at full `foreground`, so they need the
  // same AA guarantee the coloured fills below already get. They did not have
  // it: each was a fixed elevation step off the background, and where the seed
  // put background and foreground close together — Solarized dark — lifting the
  // surface far enough for depth pushed it under 4.5:1 against the very text it
  // carries. Solarized's `surface` and `accent` both shipped unreadable.
  //
  // The elevation steps stay the intent; this only pulls a fill back when that
  // intent would cost legibility.
  const card: HslColor = ensureFillContrast(rawCard, foreground);
  const surface: HslColor = ensureFillContrast(rawSurface, foreground);
  const accent: HslColor = ensureFillContrast(rawAccent, foreground);

  const mutedForeground: HslColor = mutedAgainst(card, foreground);

  // primaryAccent is read as text and icons on both the page and its cards, so
  // it is held to AA against both rather than trusted from the seed.
  const accentText: HslColor = ensureTextContrast(primaryAccent, [background, card, surface]);

  // Every fill that carries a label is held to AA here, so a preset cannot ship
  // with unreadable button text.
  const primaryFg: HslColor = readableForeground(primary);
  const primaryFill: HslColor = ensureFillContrast(primary, primaryFg);

  const destructiveSeed: HslColor = seed.destructive ?? status.destructive;
  const destructiveFg: HslColor = readableForeground(destructiveSeed);
  const destructiveFill: HslColor = ensureFillContrast(destructiveSeed, destructiveFg);
  // The fill guarantee above only proves the LABEL is readable on this colour.
  // Destructive is also the colour of every inline error, where the requirement
  // is the reverse — readable ON the background — and the same value fails it:
  // the shipped dark fill measures 3.72:1 as text. This is the primaryAccent
  // gap on the next token along, so it gets the same treatment.
  const destructiveText: HslColor = ensureTextContrast(destructiveFill, [background, card, surface]);

  const successSeed: HslColor = seed.success ?? status.success;
  const successFg: HslColor = readableForeground(successSeed);
  const successFill: HslColor = ensureFillContrast(successSeed, successFg);

  const warningSeed: HslColor = seed.warning ?? status.warning;
  const warningFg: HslColor = readableForeground(warningSeed);
  const warningFill: HslColor = ensureFillContrast(warningSeed, warningFg);

  return {
    background,
    foreground,
    card,
    // The fill was already lifted to clear AA against this text above.
    cardForeground: foreground,
    popover: card,
    popoverForeground: foreground,
    surface,
    surfaceForeground: foreground,

    primary: primaryFill,
    primaryForeground: primaryFg,
    primaryAccent: accentText,

    secondary: card,
    secondaryForeground: foreground,
    muted: card,
    mutedForeground,
    accent,
    accentForeground: foreground,

    destructive: destructiveFill,
    destructiveEmphasis: destructiveText,
    destructiveForeground: destructiveFg,
    success: successFill,
    successForeground: successFg,
    warning: warningFill,
    warningForeground: warningFg,

    border,
    input,
    ring: accentText,
    controlBorder: controlBorderFor(accentText, [background, card, surface]),
  };
}

/**
 * A dimmed foreground that still clears AA (4.5:1) on the surface it sits on.
 *
 * Muted text is where contrast bugs hide: it is dimmed on purpose, so "looks a
 * bit faint" and "fails WCAG" are hard to tell apart by eye. This walks back
 * toward the full foreground until the ratio holds rather than trusting a fixed
 * offset — the same defect Lighthouse flagged on every toast description before
 * --muted-foreground was raised from 54% to 72%.
 */

function mutedAgainst(surface: HslColor, foreground: HslColor): HslColor {
  const towardSurface: 1 | -1 = foreground.l > surface.l ? -1 : 1;

  for (let offset: number = 30; offset >= 0; offset -= 2) {
    const candidate: { l: number; h: number; s: number; } = { ...foreground, l: foreground.l + towardSurface * offset };
    if (contrastRatio(surface, candidate) >= 4.5) return candidate;
  }
  return foreground;
}

/**
 * Produce a dark palette from a light one.
 *
 * The default relationship the user gets before touching anything. It is not a
 * naive inversion: inverting hue or saturation turns a blue theme orange, and
 * inverting lightness alone leaves brand colours that were tuned for white text
 * unreadable on a dark surface.
 *
 * The rule is: keep hue, keep saturation, reflect lightness about the midpoint,
 * then rebuild every derived token from the reflected background so elevation
 * and contrast are recomputed for the new mode rather than mirrored.
 */

export function deriveDarkPalette(light: ThemePalette): ThemePalette {
  const reflect = (c: HslColor): HslColor => ({ ...c, l: 100 - c.l });

  const background: HslColor = reflect(light.background);

  return buildPalette(
    {
      background,
      // Brand hues survive; only their lightness is nudged toward the range that
      // reads on a dark surface, because a fill tuned for white text at 45%
      // lightness is muddy at 20%.
      primary: { ...light.primary, l: Math.max(40, Math.min(65, light.primary.l + 8)) },
      primaryAccent: { ...light.primaryAccent, l: Math.max(60, Math.min(85, light.primaryAccent.l + 30)) },
      destructive: DEFAULT_STATUS.dark.destructive,
      success: DEFAULT_STATUS.dark.success,
      warning: DEFAULT_STATUS.dark.warning,
    },
    'dark',
  );
}

/** The same, in the other direction, for a theme authored dark-first. */
export function deriveLightPalette(dark: ThemePalette): ThemePalette {
  const reflect = (c: HslColor): HslColor => ({ ...c, l: 100 - c.l });

  return buildPalette(
    {
      background: reflect(dark.background),
      primary: { ...dark.primary, l: Math.max(35, Math.min(55, dark.primary.l - 8)) },
      primaryAccent: { ...dark.primaryAccent, l: Math.max(30, Math.min(50, dark.primaryAccent.l - 30)) },
      destructive: DEFAULT_STATUS.light.destructive,
      success: DEFAULT_STATUS.light.success,
      warning: DEFAULT_STATUS.light.warning,
    },
    'light',
  );
}

/** Every token, as `darken` is only exported for callers that tune a seed. */
export { darken };
