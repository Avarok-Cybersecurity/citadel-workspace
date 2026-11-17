/**
 * A search over a collection folds the query once, not once per candidate.
 *
 * `matchesSearch(haystack, needle)` folds BOTH arguments on every call, and
 * every call site in this app was inside a `.filter` with the needle
 * loop-invariant — so filtering a 500-node tree NFD-normalised, mark-stripped
 * and lower-cased the same three characters 500 times, synchronously in the
 * render pass, on every keystroke.
 *
 * `searchMatcher(needle)` folds once and returns the predicate. The saving is
 * structural rather than something a unit test can time, so what is asserted
 * here is (a) that the two agree on every case the folding exists for, and
 * (b) that the needle really is folded once — counted through `normalize`,
 * which is the expensive step.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { matchesSearch, searchMatcher } from '../fold-for-search';

const original: (form?: string) => string = String.prototype.normalize;

afterEach((): void => {
  String.prototype.normalize = original;
});

/** How many times `normalize` is called while `run` executes. */
function countNormalises(run: () => void): number {
  let calls: number = 0;
  String.prototype.normalize = function patched(this: string, form?: string): string {
    calls += 1;
    return original.call(this, form);
  };
  run();
  String.prototype.normalize = original;
  return calls;
}

describe('searching a collection', () => {
  it('agrees with matchesSearch on case and diacritics', () => {
    const haystacks: string[] = ['José', 'café', 'Plain', 'nothing'];
    for (const needle of ['jose', 'CAFE', 'plain', 'zzz']) {
      const viaMatcher: boolean[] = haystacks.map(searchMatcher(needle));
      const viaPair: boolean[] = haystacks.map((h: string) => matchesSearch(h, needle));
      expect(viaMatcher, `needle ${needle}`).toEqual(viaPair);
    }
  });

  it('folds the needle once across the whole collection', () => {
    const haystacks: string[] = Array.from({ length: 50 }, (_, i: number) => `name-${i}`);

    const withMatcher: number = countNormalises((): void => {
      const matches: (h: string) => boolean = searchMatcher('name');
      haystacks.filter(matches);
    });
    const withPair: number = countNormalises((): void => {
      haystacks.filter((h: string) => matchesSearch(h, 'name'));
    });

    // 50 haystacks + 1 needle, against 50 haystacks + 50 needles.
    expect(withMatcher).toBe(51);
    expect(withPair).toBe(100);
  });

  it('still folds every haystack', () => {
    // The discrimination control: an implementation that folded NOTHING would
    // make the count above smaller still, and would break matching outright.
    expect(searchMatcher('jose')('José')).toBe(true);
    expect(searchMatcher('zzz')('José')).toBe(false);
  });
});
