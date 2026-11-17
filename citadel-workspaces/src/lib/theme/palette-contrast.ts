/**
 * The readability guarantees a generated palette has to satisfy.
 *
 * Separate from palette-builder because they answer a different question: the
 * builder decides what a theme LOOKS like, these decide whether it can be read.
 * Every preset passes through both, and the AA suite in theme-foundation exists
 * to prove the pair still holds for all of them.
 */
import type { HslColor } from './theme-types';
import { contrastRatio } from './hsl';

export function ensureFillContrast(fill: HslColor, label: HslColor, min: number = 4.5): HslColor {
  if (contrastRatio(fill, label) >= min) return fill;

  const away: 1 | -1 = label.l > fill.l ? -1 : 1;
  let candidate: HslColor = fill;

  for (let step: number = 1; step <= 60; step += 1) {
    candidate = clamp({ ...fill, l: fill.l + away * step });
    if (contrastRatio(candidate, label) >= min) return candidate;
    if (candidate.l <= 0 || candidate.l >= 100) break;
  }
  return candidate;
}

/**
 * Nudge a TEXT colour until it clears `min` against every surface it sits on.
 *
 * The mirror of ensureFillContrast, and the gap that let `primaryAccent` ship
 * unreadable: it is not a fill, it is the accent TEXT and icon colour, so no
 * fill guarantee ever applied to it. Five light presets landed between 3.5:1
 * and 4.5:1 against their own card — Nord at 3.53:1 — which is every accent
 * label in the app, in a theme the workspace is free to pick.
 *
 * Checked against all surfaces at once rather than one at a time, because
 * satisfying `card` alone can walk the colour straight into `background`.
 */
export function ensureTextContrast(text: HslColor, surfaces: readonly HslColor[], min: number = 4.5): HslColor {
  const clears = (c: HslColor): boolean => surfaces.every((s): boolean => contrastRatio(s, c) >= min);
  if (clears(text)) return text;

  // Move away from the surfaces' average lightness, so the accent darkens on a
  // light theme and lightens on a dark one without needing to know which it is.
  const meanL: number = surfaces.reduce((acc, s) => acc + s.l, 0) / surfaces.length;
  const away: 1 | -1 = meanL > text.l ? -1 : 1;
  let candidate: HslColor = text;

  for (let step: number = 1; step <= 100; step += 1) {
    candidate = clamp({ ...text, l: text.l + away * step });
    if (clears(candidate)) return candidate;
    if (candidate.l <= 0 || candidate.l >= 100) break;
  }
  return candidate;
}

/**
 * The control border: the accent hue, softened, at the lightest (light mode) or darkest (dark
 * mode) lightness that still clears 3:1 against every given surface. Starting well inside the
 * surfaces' lightness and walking away from them is what makes it the SOFTEST edge that is still
 * clearly visible, rather than the accent itself.
 */
export function controlBorderFor(accent: HslColor, surfaces: readonly HslColor[]): HslColor {
  const meanL: number = surfaces.reduce((acc, s) => acc + s.l, 0) / surfaces.length;
  const start: HslColor = { h: accent.h, s: Math.min(accent.s, 35), l: meanL > 50 ? 78 : 28 };
  return ensureTextContrast(start, surfaces, 3);
}

export function clamp(c: HslColor): HslColor {
  return { ...c, l: Math.min(100, Math.max(0, c.l)) };
}
