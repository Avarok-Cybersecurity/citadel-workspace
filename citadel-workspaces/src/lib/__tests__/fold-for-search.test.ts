/**
 * Matching used to be `toLowerCase().includes(...)` everywhere, so a name with
 * a diacritic could not be found by the spelling a colleague would actually
 * type. Sorting nearby uses `localeCompare`, so a list could show two
 * neighbours one of which was unreachable by the obvious query.
 */

import { describe, it, expect } from 'vitest';
import { foldForSearch, matchesSearch } from '../fold-for-search';

describe('matching', () => {
  it('finds an accented name by its unaccented spelling', () => {
    expect(matchesSearch('José Álvarez', 'jose')).toBe(true);
    expect(matchesSearch('José Álvarez', 'alvarez')).toBe(true);
  });

  it('finds it by the accented spelling too', () => {
    expect(matchesSearch('José Álvarez', 'josé')).toBe(true);
  });

  it('folds a combining mark the same as a precomposed character', () => {
    // These render identically and are different bytes. A user who types one
    // must find the other.
    expect(matchesSearch('café', 'café')).toBe(true);
    expect(matchesSearch('café', 'café')).toBe(true);
  });

  it('still ignores case', () => {
    expect(matchesSearch('Engineering', 'ENGIN')).toBe(true);
  });

  it('does not match something that is simply absent', () => {
    expect(matchesSearch('José', 'maria')).toBe(false);
  });

  it('does not attempt transliteration', () => {
    // Deliberate: "ß"→"ss" and "ø"→"o" are language-specific, and a matcher
    // that is right for German and wrong for Danish is worse than a
    // predictable one.
    expect(matchesSearch('Straße', 'strasse')).toBe(false);
    expect(foldForSearch('Straße')).toBe('straße');
  });

  it('leaves non-latin scripts alone', () => {
    expect(matchesSearch('東京', '東')).toBe(true);
  });
});
