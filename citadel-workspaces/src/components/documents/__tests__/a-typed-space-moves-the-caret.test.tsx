/**
 * Space typed at the end of a paragraph is a character like any other: it is in the document
 * and the caret stands after it, over the real cdoc-edit. The layout used to drop a
 * paragraph's trailing spaces as TeX's \par drops trailing glue, so the space was stored but
 * the caret stayed where it was until the next word arrived: the owner's "Space does nothing".
 */
import { describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { mount, settled, statedViewport, type, type Mounted } from './editor-harness';
import type { PageRect } from '@/lib/cdoc/editor/controller';

statedViewport();

const caretX = (m: Mounted): number => {
  const caret: PageRect | null = m.editor.state.caret;
  if (caret === null) throw new Error('no caret');
  return caret.rect.x;
};

async function typed(m: Mounted, text: string): Promise<number> {
  type(m.input, text);
  await settled(m.editor);
  return caretX(m);
}

async function documentText(m: Mounted): Promise<string> {
  await act(async () => { await m.editor.execute({ name: 'selectAll' }); });
  await settled(m.editor);
  return m.editor.selectionText();
}

describe.each(['worker', 'main-thread'] as const)('a typed space, with the %s renderer', (mode: 'worker' | 'main-thread') => {
  it('moves the caret past it at the end of a paragraph, one space at a time', async () => {
    const m: Mounted = await mount(mode);
    act(() => m.input.focus());
    const word: number = await typed(m, 'ab');
    const one: number = await typed(m, ' ');
    const two: number = await typed(m, ' ');
    expect(one).toBeGreaterThan(word);
    expect(two - one).toBe(one - word);
    const next: number = await typed(m, 'c');
    expect(next).toBeGreaterThan(two);
    expect(await documentText(m)).toBe('ab  c');
    expect(m.errors).toEqual([]);
  });

  it('moves the caret in a paragraph of nothing but spaces', async () => {
    const m: Mounted = await mount(mode);
    act(() => m.input.focus());
    await settled(m.editor);
    const start: number = caretX(m);
    const one: number = await typed(m, ' ');
    expect(one).toBeGreaterThan(start);
    expect(await documentText(m)).toBe(' ');
    expect(m.errors).toEqual([]);
  });
});
