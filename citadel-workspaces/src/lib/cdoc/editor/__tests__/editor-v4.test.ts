/**
 * The v4 editor members over the real cdoc-edit (InProcessCdocClient: production host, engine
 * and wasm): the selection's text for the clipboard, Cut, ids the editor picks, the caret's
 * section, the style sheet, Clear Formatting and viewport-limited selection rectangles.
 */
import { describe, expect, it } from 'vitest';
import { inProcessRuntime, type TestRuntime } from '../../__tests__/wasm-rig';
import { createEditorOpener } from '../editor-opener';
import type { EditorSession } from '../editor-session';
import type { DocumentStyle, EditorState } from '../controller';
import { CLEAR_FORMATTING } from '../caret-formatting';
import { decodeResult } from '../wire/decode-result';

async function blank(): Promise<EditorSession> {
  let next: number = 1;
  const runtime: TestRuntime = inProcessRuntime('worker');
  return createEditorOpener({ client: runtime.client, renderer: runtime.renderer }, (b: Uint8Array): Uint8Array => b.map((): number => next++ & 0xff))({ kind: 'blank' });
}

const utf8: TextDecoder = new TextDecoder();

describe('the v4 editor members', () => {
  it('carries the selected text in the result, for a copy event to set synchronously', async () => {
    const editor: EditorSession = await blank();
    await editor.execute({ name: 'insertText', text: 'copy\nme' });
    expect(editor.state.selectionText).toEqual({ complete: true, text: '' });
    const all: EditorState = await editor.execute({ name: 'selectAll' });
    expect(all.selectionText).toEqual({ complete: true, text: 'copy\nme' });
    expect(await editor.selectionText()).toBe('copy\nme');
  });

  it('cuts the selection as one undo step, and refuses to cut a caret', async () => {
    const editor: EditorSession = await blank();
    await editor.execute({ name: 'insertText', text: 'gone' });
    await expect(editor.execute({ name: 'cut' })).rejects.toThrow();
    await editor.execute({ name: 'selectAll' });
    await editor.execute({ name: 'cut' });
    expect(utf8.decode((await editor.exportAs({ format: 'txt' })).bytes).trim()).toBe('');
    await editor.execute({ name: 'undo' });
    expect(utf8.decode((await editor.exportAs({ format: 'txt' })).bytes).trim()).toBe('gone');
  });

  it('reports the footnote and list instance it made under ids it picked', async () => {
    const editor: EditorSession = await blank();
    await editor.execute({ name: 'insertText', text: 'note' });
    const footnote: EditorState = await editor.execute({ name: 'insertNewFootnote' });
    expect(footnote.created).toHaveLength(1);
    expect(footnote.created[0].kind).toBe('footnote');
    expect(footnote.created[0].id).toBeGreaterThan(0);
    const list: EditorState = await editor.execute({ name: 'setNumberingKind', kind: 'decimal', level: 0 });
    expect(list.created.map((c) => c.kind)).toEqual(['numbering']);
    expect(list.caretFormatting.known && list.caretFormatting.paragraph.numbering?.numId).toBe(list.created[0].id);
    await expect(editor.execute({ name: 'setNumberingKind', kind: 'bullet', level: 9 })).rejects.toThrow(/list level 9 is not 0..=8/);
  });

  it("reads the caret's section: A4 portrait with Normal margins for a blank, landscape once swapped", async () => {
    const editor: EditorSession = await blank();
    const first: EditorState = await editor.execute({ name: 'insertText', text: 'x' });
    if (!first.caretFormatting.known) throw new Error('no formatting');
    expect(first.caretFormatting.section.size).toEqual({ width: 59530, height: 84190, orientation: 'portrait' });
    expect(first.caretFormatting.section.columns.count).toBe(1);
    const turned: EditorState = await editor.execute({ name: 'setSectionProperty', patch: { orientation: 'landscape' } });
    if (!turned.caretFormatting.known) throw new Error('no formatting');
    expect(turned.caretFormatting.section.size).toEqual({ width: 84190, height: 59530, orientation: 'landscape' });
  });

  it('lists the style sheet with what each style resolves to', async () => {
    const styles: DocumentStyle[] = await (await blank()).styles();
    expect(styles.length).toBeGreaterThan(0);
    expect(styles.every((s: DocumentStyle): boolean => s.id.length > 0 && ['paragraph', 'character', 'table'].includes(s.kind))).toBe(true);
  });

  it('clears formatting back to the styles', async () => {
    const editor: EditorSession = await blank();
    await editor.execute({ name: 'toggleMark', mark: 'bold' });
    await editor.execute({ name: 'insertText', text: 'bold' });
    const selected: EditorState = await editor.execute({ name: 'selectAll' });
    expect(selected.caretFormatting.known && selected.caretFormatting.run.bold).toBe(true);
    const cleared: EditorState = await editor.execute({ name: 'setRunProperty', patch: CLEAR_FORMATTING });
    expect(cleared.caretFormatting.known && cleared.caretFormatting.runDirect.bold).toBeUndefined();
    expect(cleared.caretFormatting.known && cleared.caretFormatting.run.bold === true).toBe(false);
  });

  it('carries selection rectangles for the viewport only once one is set', async () => {
    const editor: EditorSession = await blank();
    await editor.execute({ name: 'insertText', text: 'line\n'.repeat(120) });
    const everywhere: EditorState = await editor.execute({ name: 'selectAll' });
    const pagesWith = (s: EditorState): number[] => [...new Set(s.selectionRects.map((r) => r.page))].sort((a, b) => a - b);
    expect(pagesWith(everywhere).length).toBe(everywhere.pageCount);
    expect(everywhere.pageCount).toBeGreaterThanOrEqual(3);
    const onScreen: EditorState = await editor.setViewport([1]);
    expect(pagesWith(onScreen)).toEqual([1]);
    const moved: EditorState = await editor.setViewport([0]);
    expect(pagesWith(moved)).toEqual([0]);
  });

  it('refuses a result of another version, 4 and 5 included, and a count its bytes cannot hold, by name', () => {
    const cde = (version: number, ...rest: number[]): Uint8Array => Uint8Array.from([0x43, 0x44, 0x45, version, ...rest]);
    expect(() => decodeResult(cde(5))).toThrow(/CDE version 5; this UI reads version 6/);
    expect(() => decodeResult(cde(4))).toThrow(/CDE version 4; this UI reads version 6/);
    // An empty update, then 2^28 dirty pages claimed with nothing after them.
    expect(() => decodeResult(cde(6, 0x00, 0x80, 0x80, 0x80, 0x80, 0x01))).toThrow(/the dirty pages claims 268435456 entries, but only 0 bytes remain/);
  });
});
