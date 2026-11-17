import type { HslColor } from './theme-types';

/**
 * HSL helpers.
 *
 * Colours are stored as channels rather than strings so the colour wheel can
 * move one axis at a time and so light->dark derivation is arithmetic. These
 * are the only places that know the CSS spelling.
 */

/** Clamp to the channel's legal range. Hue wraps; saturation and lightness saturate. */
export function clampHsl({ h, s, l }: HslColor): HslColor {
  return {
    h: ((h % 360) + 360) % 360,
    s: Math.min(100, Math.max(0, s)),
    l: Math.min(100, Math.max(0, l)),
  };
}

/** The form a CSS custom property holds: `H S% L%`, composable with `/ alpha`. */
export function toCssValue(color: HslColor): string {
  const { h, s, l } = clampHsl(color);
  return `${round(h)} ${round(s)}% ${round(l)}%`;
}

/** A complete colour, for anywhere that cannot use the variable form. */
export function toCssColor(color: HslColor): string {
  return `hsl(${toCssValue(color)})`;
}

/** Parse `H S% L%` back into channels. Returns null rather than guessing. */
export function fromCssValue(value: string): HslColor | null {
  const match: RegExpMatchArray | null = value.trim().match(/^(-?[\d.]+)\s+(-?[\d.]+)%\s+(-?[\d.]+)%$/);
  if (!match) return null;
  const [, h, s, l] = match;
  return clampHsl({ h: Number(h), s: Number(s), l: Number(l) });
}

/** Parse `#rgb` / `#rrggbb`, which is what a colour input emits. */
export function fromHex(hex: string): HslColor | null {
  const cleaned: string = hex.trim().replace(/^#/, '');
  const full: string =
    cleaned.length === 3
      ? cleaned.split('').map((c) => c + c).join('')
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;

  const r: number = parseInt(full.slice(0, 2), 16) / 255;
  const g: number = parseInt(full.slice(2, 4), 16) / 255;
  const b: number = parseInt(full.slice(4, 6), 16) / 255;

  const max: number = Math.max(r, g, b);
  const min: number = Math.min(r, g, b);
  const l: number = (max + min) / 2;
  const d: number = max - min;

  if (d === 0) return { h: 0, s: 0, l: l * 100 };

  const s: number = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;

  return clampHsl({ h: h * 60, s: s * 100, l: l * 100 });
}

/** `#rrggbb`, which is the only form `<input type="color">` accepts. */
export function toHex(color: HslColor): string {
  const { h, s, l } = clampHsl(color);
  const sN: number = s / 100;
  const lN: number = l / 100;

  const c: number = (1 - Math.abs(2 * lN - 1)) * sN;
  const x: number = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m: number = lN - c / 2;

  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] :
    [c, 0, x];

  const to255 = (v: number): string => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to255(r)}${to255(g)}${to255(b)}`;
}

/**
 * Relative luminance, per WCAG 2.x.
 *
 * Used to choose a readable foreground automatically instead of asking the user
 * to pick one for every surface — the commonest way a hand-made theme ends up
 * unreadable.
 */
export function relativeLuminance(color: HslColor): number {
  const hex: string = toHex(color).slice(1);
  const channel = (i: number): number => {
    const v: number = parseInt(hex.slice(i * 2, i * 2 + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** WCAG contrast ratio between two colours, 1..21. */
export function contrastRatio(a: HslColor, b: HslColor): number {
  const la: number = relativeLuminance(a);
  const lb: number = relativeLuminance(b);
  const lighter: number = Math.max(la, lb);
  const darker: number = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * A foreground that stays readable on `background`.
 *
 * Picks whichever of the supplied candidates has the higher contrast, so a theme
 * cannot end up with white text on a pale surface just because someone dragged a
 * lightness slider.
 */
export function readableForeground(
  background: HslColor,
  light: HslColor = { h: 0, s: 0, l: 100 },
  dark: HslColor = { h: 235, s: 18, l: 13 },
): HslColor {
  return contrastRatio(background, light) >= contrastRatio(background, dark) ? light : dark;
}

/** Shift lightness by `delta` points, staying in range. */
export function lighten(color: HslColor, delta: number): HslColor {
  return clampHsl({ ...color, l: color.l + delta });
}

export function darken(color: HslColor, delta: number): HslColor {
  return lighten(color, -delta);
}

/** Round to one decimal — enough for colour, short enough to keep serialized themes small. */
function round(n: number): number {
  return Math.round(n * 10) / 10;
}
