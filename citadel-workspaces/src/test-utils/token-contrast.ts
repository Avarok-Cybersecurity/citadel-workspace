/**
 * Contrast, computed from the tokens the app actually ships.
 *
 * jsdom applies no stylesheet and composites nothing, so a tinted background's
 * contrast cannot be observed in a unit test — which is why the class of bug
 * this guards (a translucent fill wearing the text colour meant for the solid
 * one) reached a user. It CAN be computed: the tint's alpha, the token it tints,
 * and the surface underneath are all facts in `src/index.css`.
 *
 * The maths is the app's own — `contrastRatio`, `toHex` and `fromHex` from
 * lib/theme/hsl, the same helpers `ensureTextContrast` uses to keep generated
 * palettes readable. A second implementation here could agree with itself while
 * disagreeing with the product.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrastRatio, fromCssValue, fromHex, toHex } from '@/lib/theme/hsl';
import type { HslColor } from '@/lib/theme/theme-types';

export type ThemeName = 'light' | 'dark';

/** WCAG AA: body text. */
export const AA_TEXT: number = 4.5;
/** WCAG AA: icons and other non-text indicators (1.4.11). */
export const AA_NON_TEXT: number = 3;

/**
 * The custom properties of one theme, resolved.
 *
 * `:root` is light and `.dark` is dark, per the convention index.css states in
 * its own header. Dark is read as an overlay on light because the `.dark` block
 * only redefines what changes — reading it alone would leave holes.
 */
export function readThemeTokens(theme: ThemeName): Readonly<Record<string, HslColor>> {
  const css: string = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');
  const light: Record<string, HslColor> = parseBlock(css, ':root {');
  if (theme === 'light') return light;
  return { ...light, ...parseBlock(css, '.dark {') };
}

/** Look a token up, failing loudly rather than silently measuring black on black. */
export function token(tokens: Readonly<Record<string, HslColor>>, name: string): HslColor {
  const found: HslColor | undefined = tokens[name];
  if (!found) throw new Error(`--${name} is not defined in src/index.css`);
  return found;
}

/**
 * `bg-<token>/<alpha>` — what the browser paints for a Tailwind opacity
 * modifier: source-over compositing in gamma-encoded sRGB, which is the space
 * the channels are already in. Mixing in linear light would give a different,
 * and wrong, answer.
 */
export function overTint(fill: HslColor, alphaPercent: number, backdrop: HslColor): HslColor {
  const a: number = alphaPercent / 100;
  const f: string = toHex(fill).slice(1);
  const b: string = toHex(backdrop).slice(1);
  const mix = (i: number): string => {
    const fv: number = parseInt(f.slice(i * 2, i * 2 + 2), 16);
    const bv: number = parseInt(b.slice(i * 2, i * 2 + 2), 16);
    return Math.round(fv * a + bv * (1 - a)).toString(16).padStart(2, '0');
  };
  const composited: HslColor | null = fromHex(`#${mix(0)}${mix(1)}${mix(2)}`);
  if (!composited) throw new Error('compositing produced an unparseable colour');
  return composited;
}

/** The ratio a reader actually gets: `text` on `fill` at `alpha` over `backdrop`. */
export function tintedContrast(
  tokens: Readonly<Record<string, HslColor>>,
  fill: string,
  alphaPercent: number,
  backdrop: string,
  text: string,
): number {
  return contrastRatio(overTint(token(tokens, fill), alphaPercent, token(tokens, backdrop)), token(tokens, text));
}

function parseBlock(css: string, opener: string): Record<string, HslColor> {
  const start: number = css.indexOf(opener);
  if (start === -1) throw new Error(`src/index.css has no \`${opener}\` block`);
  const body: string = css.slice(start + opener.length, css.indexOf('\n  }', start));
  const out: Record<string, HslColor> = {};
  for (const [, name, value] of body.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    const parsed: HslColor | null = fromCssValue(value.replace(/\/\*.*?\*\//g, '').trim());
    // `var(--x)` aliases (the sidebar family) parse to null; they are resolved
    // by CSS, not here, and nothing in these tests reads one.
    if (parsed) out[name] = parsed;
  }
  return out;
}
