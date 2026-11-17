/**
 * A title is one line, not blank and at most DOC_TITLE_MAX_LENGTH long, whoever wrote it: the
 * person typing one, or an earlier editor's document read when it is moved (a peer wrote that
 * value, so it is re-checked rather than trusted).
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { DOC_ATTRIBUTES_MAP, DOC_TITLE_KEY, DOC_TITLE_MAX_LENGTH, validateDocTitle, readDocTitle } from '../doc-title';

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

describe('the title an earlier document carries', () => {
  it('is read as one line', () => {
    const doc: Y.Doc = new Y.Doc();
    doc.getMap(DOC_ATTRIBUTES_MAP).set(DOC_TITLE_KEY, '  Road \n map ');
    expect(readDocTitle(doc)).toBe('Road map');
  });

  it('is not trusted: none, a non-string or a blank is no title, and a long one is cut', () => {
    const doc: Y.Doc = new Y.Doc();
    expect(readDocTitle(doc)).toBeNull();
    for (const unusable of [42, '   ']) {
      doc.getMap(DOC_ATTRIBUTES_MAP).set(DOC_TITLE_KEY, unusable);
      expect(readDocTitle(doc)).toBeNull();
    }
    doc.getMap(DOC_ATTRIBUTES_MAP).set(DOC_TITLE_KEY, 'y'.repeat(500));
    expect(readDocTitle(doc)).toBe('y'.repeat(DOC_TITLE_MAX_LENGTH));
  });
});
