/**
 * The guidelines' size floors: horizontal 120 px wide, stacked and wordmark 96, the mark 16 px,
 * and the compact cut (stroke 22) for any mark drawn under 32. Each is checked on both sides of
 * its line, so a floor that silently stopped applying would fail here.
 */
import { describe, it, expect } from 'vitest';
import { resolveLockup, type ResolvedLockup } from '../lockup';
import { MARK } from '../artwork/mark.generated';
import { MARK_COMPACT } from '../artwork/mark-compact.generated';
import { LOGO_HORIZONTAL } from '../artwork/logo-horizontal.generated';

const heightForWidth = (width: number): number => (width * LOGO_HORIZONTAL.height) / LOGO_HORIZONTAL.width;

describe('lockup sizes', () => {
  it('uses the compact cut under 32 px and the production cut from 32', () => {
    expect(resolveLockup('mark', 31.9).artwork).toBe(MARK_COMPACT);
    expect(resolveLockup('mark', 32).artwork).toBe(MARK);
    expect(MARK_COMPACT.strokeWidth).toBe(22);
    expect(MARK.strokeWidth).toBe(14);
  });

  it('refuses a mark under 16 px', () => {
    expect(() => resolveLockup('mark', 15.9)).toThrow(RangeError);
    expect(resolveLockup('mark', 16).height).toBe(16);
  });

  it('refuses a horizontal lockup under 120 px wide', () => {
    expect(() => resolveLockup('horizontal', heightForWidth(119.5))).toThrow(/under the 120px minimum/);
    const ok: ResolvedLockup = resolveLockup('horizontal', heightForWidth(120.5));
    expect(ok.width).toBeGreaterThanOrEqual(120);
  });

  it('refuses the wordmark and the stacked lockup under 96 px wide', () => {
    expect(() => resolveLockup('wordmark', 10)).toThrow(/96px minimum/);
    expect(() => resolveLockup('stacked', 40)).toThrow(/96px minimum/);
    expect(resolveLockup('wordmark', 12).width).toBeGreaterThanOrEqual(96);
    expect(resolveLockup('stacked', 48).width).toBeGreaterThanOrEqual(96);
  });

  it('refuses a size that is not a size', () => {
    expect(() => resolveLockup('mark', Number.NaN)).toThrow(RangeError);
    expect(() => resolveLockup('horizontal', 0)).toThrow(RangeError);
  });
});
