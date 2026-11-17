/**
 * The logo's colours follow the ground the theme paints, which is dark exactly when `.dark` is
 * on the root (next-themes, attribute="class"). A rule keyed on anything else can put the
 * dark-ground purple on a light ground: an OS dark-mode query did, because next-themes marks a
 * light theme `.light` and the rule only excluded `[data-theme='light']`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND_COLOURS } from '../artwork/brand-rules.generated';

const CSS: string = readFileSync(join(process.cwd(), 'src', 'styles', 'brand-tokens.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** selector -> its declarations, for the file's top-level rules. */
function rules(css: string): Map<string, Record<string, string>> {
  const out: Map<string, Record<string, string>> = new Map();
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls: Record<string, string> = {};
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls[name] = value.trim().toLowerCase();
    out.set(selector.trim(), decls);
  }
  return out;
}

describe('brand tokens', () => {
  it('carry the kit values: light ground on :root, dark ground on .dark', () => {
    const r: Map<string, Record<string, string>> = rules(CSS);
    expect(r.get(':root')).toEqual({
      '--citadel-ink': BRAND_COLOURS.light.ink.toLowerCase(),
      '--citadel-arrow': BRAND_COLOURS.light.arrow.toLowerCase(),
    });
    expect(r.get('.dark')).toEqual({
      '--citadel-ink': BRAND_COLOURS.dark.ink.toLowerCase(),
      '--citadel-arrow': BRAND_COLOURS.dark.arrow.toLowerCase(),
    });
  });

  it('switch on nothing but the .dark class the ground switches on', () => {
    expect(CSS).not.toMatch(/@media/);
    expect([...rules(CSS).keys()].sort()).toEqual(['.dark', ':root']);
  });
});
