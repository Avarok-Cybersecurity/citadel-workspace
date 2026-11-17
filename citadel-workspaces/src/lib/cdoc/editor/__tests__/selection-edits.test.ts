/**
 * What Word does to a selection, over the real cdoc-edit: typing replaces it, Backspace and
 * Delete remove it, Shift+arrows extend it, and a selection over several pages carries a
 * highlight rect on each page it covers, cleared when it collapses.
 */
import { describe, expect, it } from 'vitest';
import { inProcessRuntime, type TestRuntime } from '../../__tests__/wasm-rig';
import { createEditorOpener } from '../editor-opener';
import type { EditorSession } from '../editor-session';
import type { EditorState } from '../controller';

async function blank(): Promise<EditorSession> {
  const runtime: TestRuntime = inProcessRuntime('worker');
  return createEditorOpener({ client: runtime.client, renderer: runtime.renderer }, (b: Uint8Array): Uint8Array => b.fill(0x31))({ kind: 'blank' });
}

async function text(editor: EditorSession): Promise<string> {
  await editor.execute({ name: 'selectAll' });
  return editor.selectionText();
}

/** "alpha beta" with "alpha" selected, by Shift+Ctrl+Right from the line's start. */
async function alphaSelected(): Promise<EditorSession> {
  const editor: EditorSession = await blank();
  await editor.execute({ name: 'insertText', text: 'alpha beta' });
  await editor.execute({ name: 'moveCaret', granularity: 'lineBoundary', forward: false, extend: false });
  await editor.execute({ name: 'moveCaret', granularity: 'word', forward: true, extend: true });
  expect(await editor.selectionText()).toMatch(/^alpha ?$/);
  return editor;
}

describe('a selection', () => {
  it('is replaced by what is typed', async () => {
    const editor: EditorSession = await alphaSelected();
    await editor.execute({ name: 'insertText', text: 'gamma' });
    expect(await text(editor)).toMatch(/^gamma ?beta$/);
  });

  it.each(['deleteBackward', 'deleteForward'] as const)('is removed whole by %s', async (name: 'deleteBackward' | 'deleteForward') => {
    const editor: EditorSession = await alphaSelected();
    await editor.execute({ name, unit: 'char' });
    expect(await text(editor)).toMatch(/^ ?beta$/);
  });

  it('grows a character at a time with Shift+Right, and collapses with a plain move', async () => {
    const editor: EditorSession = await blank();
    await editor.execute({ name: 'insertText', text: 'abc' });
    await editor.execute({ name: 'moveCaret', granularity: 'lineBoundary', forward: false, extend: false });
    await editor.execute({ name: 'moveCaret', granularity: 'char', forward: true, extend: true });
    const two: EditorState = await editor.execute({ name: 'moveCaret', granularity: 'char', forward: true, extend: true });
    expect(await editor.selectionText()).toBe('ab');
    expect(two.selectionRects).toHaveLength(1);
    const collapsed: EditorState = await editor.execute({ name: 'moveCaret', granularity: 'char', forward: true, extend: false });
    expect(collapsed.selectionRects).toEqual([]);
  });

  it('carries a highlight on every page it covers', async () => {
    const editor: EditorSession = await blank();
    await editor.execute({ name: 'insertText', text: 'line\n'.repeat(120) });
    const all: EditorState = await editor.execute({ name: 'selectAll' });
    expect(all.pageCount).toBeGreaterThanOrEqual(3);
    // No viewport set: the record carries rects for every page.
    expect(new Set(all.selectionRects.map((r) => r.page)).size).toBe(all.pageCount);
  });
});
