/**
 * Scrolling reports the viewport every frame, and each report answers with a full result. One
 * that changes nothing keeps the state object and emits no `selection`, so the ribbon, the
 * overlays and presence do no work for it; one that changes the rectangles drawn still does.
 * Over the real cdoc-edit (production host, engine and wasm).
 */
import { describe, expect, it } from 'vitest';
import { inProcessRuntime, type TestRuntime } from '../../__tests__/wasm-rig';
import { createEditorOpener } from '../editor-opener';
import type { EditorSession } from '../editor-session';
import type { EditorState } from '../controller';
import { sameValue } from '../same-value';

async function blank(): Promise<EditorSession> {
  let next: number = 1;
  const runtime: TestRuntime = inProcessRuntime('worker');
  return createEditorOpener({ client: runtime.client, renderer: runtime.renderer }, (b: Uint8Array): Uint8Array => b.map((): number => next++ & 0xff))({ kind: 'blank' });
}

function selections(editor: EditorSession): EditorState[] {
  const seen: EditorState[] = [];
  editor.on('selection', (s: EditorState): void => { seen.push(s); });
  return seen;
}

describe('a result that changes nothing', () => {
  it('keeps the state and emits nothing, for a caret scrolled past page after page', async () => {
    const editor: EditorSession = await blank();
    await editor.execute({ name: 'insertText', text: 'line\n'.repeat(120) });
    const before: EditorState = editor.state;
    const seen: EditorState[] = selections(editor);
    for (const page of [0, 1, 2, 1, 0]) expect(await editor.setViewport([page])).toBe(before);
    expect(seen).toEqual([]);
    expect(editor.state).toBe(before);
  });

  it('still emits when the viewport changes the rectangles a selection draws', async () => {
    const editor: EditorSession = await blank();
    await editor.execute({ name: 'insertText', text: 'line\n'.repeat(120) });
    await editor.execute({ name: 'selectAll' });
    const seen: EditorState[] = selections(editor);
    await editor.setViewport([1]);
    await editor.setViewport([1]);
    await editor.setViewport([2]);
    expect(seen.map((s: EditorState) => [...new Set(s.selectionRects.map((r) => r.page))])).toEqual([[1], [2]]);
  });
});

describe('sameValue', () => {
  it('compares decoded values by their data', () => {
    expect(sameValue({ a: [1n, 'x', null], b: new Set(['bold']), c: Uint8Array.of(1, 2) }, { a: [1n, 'x', null], b: new Set(['bold']), c: Uint8Array.of(1, 2) })).toBe(true);
    expect(sameValue({ a: 1n }, { a: 2n })).toBe(false);
    expect(sameValue(new Set(['bold']), new Set(['italic']))).toBe(false);
    expect(sameValue(new Set(['bold']), new Set(['bold', 'italic']))).toBe(false);
    expect(sameValue(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
    expect(sameValue(Uint8Array.of(1), Uint8Array.of(1, 2))).toBe(false);
    expect(sameValue([1], [1, 2])).toBe(false);
    expect(sameValue({ a: undefined }, { b: undefined })).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameValue(null, {})).toBe(false);
    expect(sameValue([1], { 0: 1, length: 1 })).toBe(false);
  });
});
