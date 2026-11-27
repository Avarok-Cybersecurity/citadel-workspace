/**
 * A title is one line, not blank and at most DOC_TITLE_MAX_LENGTH long.
 */
import { describe, it, expect } from 'vitest';
import { DOC_TITLE_MAX_LENGTH, validateDocTitle } from '../doc-title';

describe('validateDocTitle', () => {
  it('trims and collapses whitespace', () => {
    expect(validateDocTitle('  Q3 \n plan\t ')).toEqual({ ok: true, title: 'Q3 plan' });
  });
  it.each(['', '   ', '\n\t'])('rejects blank %j', (raw: string) => {
    expect(validateDocTitle(raw).ok).toBe(false);
  });
  it('accepts exactly the maximum and rejects one more', () => {
    expect(validateDocTitle('x'.repeat(DOC_TITLE_MAX_LENGTH)).ok).toBe(true);
    expect(validateDocTitle('x'.repeat(DOC_TITLE_MAX_LENGTH + 1)).ok).toBe(false);
  });
});
