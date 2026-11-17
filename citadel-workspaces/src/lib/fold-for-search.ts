/**
 * Normalise a string for matching.
 *
 * Every matcher in the app was `toLowerCase().includes(...)`, so "jose" did not
 * find "José" and "cafe" did not find "café". The names most likely to carry a
 * diacritic are exactly the ones a colleague will type without it, and the
 * sorting nearby already uses `localeCompare` — so a sorted list could show two
 * neighbours, one of which was unfindable by the obvious query.
 *
 * NFD splits a letter from its combining marks; the range strips the marks. It
 * does not attempt transliteration — "ß" does not become "ss" and "ø" does not
 * become "o" — because those are language-specific rules, and a matcher that is
 * right for German and wrong for Danish is worse than one that is predictable.
 */
export function foldForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Whether `haystack` contains `needle`, ignoring case and diacritics. */
export function matchesSearch(haystack: string, needle: string): boolean {
  return foldForSearch(haystack).includes(foldForSearch(needle));
}

/**
 * A predicate that folds the needle ONCE.
 *
 * `matchesSearch` folds both arguments on every call, and every call site in
 * this app is inside a `.filter` over a collection with the needle
 * loop-invariant — so the query was NFD-normalised, mark-stripped and
 * lower-cased once per candidate. Filtering a 500-node tree meant 500 redundant
 * Unicode normalisations of the same three characters, synchronously in the
 * render pass, on every keystroke.
 *
 * `matchesSearch` remains for a genuine one-off comparison; use this whenever
 * the needle is fixed across the collection.
 */
export function searchMatcher(needle: string): (haystack: string) => boolean {
  const folded: string = foldForSearch(needle);
  return (haystack: string): boolean => foldForSearch(haystack).includes(folded);
}
