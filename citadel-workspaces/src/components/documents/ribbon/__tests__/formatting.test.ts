/** The ribbon's value rules: Word's size steps, served families, and what a link may open. */
import { describe, expect, it } from 'vitest';
import { FONT_MANIFEST } from '@/lib/cdoc/generated/font-manifest';
import { WORD_FONT_SIZES, fontFamilies, grownSize, lineSpacingLabel, servedFamily, shrunkSize } from '../formatting';
import { linkTarget } from '../link-target';
import { fontFaceCss } from '../CdocFontFaces';

describe('font sizes', () => {
  it('steps along Word’s list, from sizes on it and between its entries', () => {
    expect(grownSize(22)).toBe(24);
    expect(grownSize(23)).toBe(24);
    expect(shrunkSize(23)).toBe(22);
    expect(shrunkSize(16)).toBeNull();
    expect(grownSize(WORD_FONT_SIZES[WORD_FONT_SIZES.length - 1])).toBeNull();
  });

  it('labels line spacing as Word does', () => {
    expect([240, 276, 360].map(lineSpacingLabel)).toEqual(['1.0', '1.15', '1.5']);
  });
});

describe('font families', () => {
  it('offers every served face and every alias, and serves them as the engine does', () => {
    expect(fontFamilies(FONT_MANIFEST)).toEqual(['Calibri', 'Calibri Light', 'Carlito']);
    expect(servedFamily('Calibri Light', FONT_MANIFEST)).toBe('Carlito');
    expect(servedFamily('Carlito', FONT_MANIFEST)).toBe('Carlito');
    expect(servedFamily('Times New Roman', FONT_MANIFEST)).toBe(FONT_MANIFEST.fallback);
  });

  it('declares one CSS face per served face, at the served URL', () => {
    const css: string = fontFaceCss(FONT_MANIFEST, '/fonts/cdoc/');
    expect(css.match(/@font-face/g)).toHaveLength(FONT_MANIFEST.faces.length);
    expect(css).toContain('url("/fonts/cdoc/Carlito-BoldItalic.ttf")');
  });
});

describe('link targets', () => {
  it.each([
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['example.com', 'https://example.com/'],
    ['  example.com:8080/x ', 'https://example.com:8080/x'],
    ['mailto:ada@example.com', 'mailto:ada@example.com'],
    ['example.com/a plan', 'https://example.com/a%20plan'],
  ])('accepts %s as %s', (input: string, href: string) => {
    expect(linkTarget(input)).toEqual({ ok: true, href });
  });

  it.each(['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'tel:+15551234', '', '   ', 'https://'])('refuses %j', (input: string) => {
    expect(linkTarget(input).ok).toBe(false);
  });

  it('refuses a name with spaces in it, which one engine would encode into a dead link', () => {
    expect(linkTarget('not a url')).toEqual({ ok: false, reason: 'A web address cannot have spaces in its name.' });
  });
});
