import { describe, it, expect, beforeEach } from 'vitest';
import { syncThemeColorMeta } from '../theme-color-meta';

/**
 * The titlebar colour is the one part of the app's surface that cannot be
 * observed from inside it, so these assert the tag's content directly.
 */
describe('syncThemeColorMeta', () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta name="theme-color" content="#000000">';
    document.documentElement.style.removeProperty('--background');
  });

  const meta: () => string | null | undefined = (): string | null | undefined => document.querySelector('meta[name="theme-color"]')?.getAttribute('content');

  it('writes the computed background as hex', () => {
    document.documentElement.style.setProperty('--background', '235 18% 13%');
    syncThemeColorMeta();
    expect(meta()).toBe('#1b1c27');
  });

  it('follows the variable when the theme changes', () => {
    document.documentElement.style.setProperty('--background', '235 18% 13%');
    syncThemeColorMeta();
    document.documentElement.style.setProperty('--background', '0 0% 100%');
    syncThemeColorMeta();
    expect(meta()).toBe('#ffffff');
  });

  it('leaves the existing value alone rather than writing something unparseable', () => {
    // A wrong titlebar colour is worse than a stale one, and the only place
    // this shows up is on a device.
    document.documentElement.style.setProperty('--background', 'not-a-colour');
    syncThemeColorMeta();
    expect(meta()).toBe('#000000');
  });

  it('does nothing when the page has no theme-color tag', () => {
    document.head.innerHTML = '';
    document.documentElement.style.setProperty('--background', '235 18% 13%');
    expect(() => syncThemeColorMeta()).not.toThrow();
  });
});
