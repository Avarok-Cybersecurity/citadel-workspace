/**
 * The v6 editor members over the real cdoc-edit (production host, engine and wasm): stories
 * (a section's header, a footnote's body) entered, typed into, selected whole and left, and the
 * list where the selection starts, named and marked mixed. Encodings of the three new requests
 * and of the record's two new sections are pinned byte for byte.
 */
import { describe, expect, it } from 'vitest';
import { inProcessRuntime, type TestRuntime } from '../../__tests__/wasm-rig';
import { createEditorOpener } from '../editor-opener';
import type { EditorSession } from '../editor-session';
import type { EditorOrigin, EditorState } from '../controller';
import { encodeCommand } from '../wire/encode-command';
import { RecordReader } from '../wire/decode-records';
import { readRemote, readStory } from '../wire/decode-story';
import { readList } from '../wire/decode-formatting';

async function open(from: EditorOrigin = { kind: 'blank' }): Promise<EditorSession> {
  let next: number = 1;
  const runtime: TestRuntime = inProcessRuntime('worker');
  return createEditorOpener({ client: runtime.client, renderer: runtime.renderer }, (b: Uint8Array): Uint8Array => b.map((): number => next++ & 0xff))(from);
}

async function selected(editor: EditorSession): Promise<string> {
  const all: EditorState = await editor.execute({ name: 'selectAll' });
  if (!all.selectionText.complete) throw new Error('selection past the cap');
  return all.selectionText.text;
}

describe('stories', () => {
  it('enters a section header, types there, selects only it, and returns to the body', async () => {
    const editor: EditorSession = await open();
    await editor.execute({ name: 'insertText', text: 'body text' });
    expect(editor.state.story).toEqual({ kind: 'body' });
    const header: EditorState = await editor.execute({ name: 'editHeaderFooter', furniture: 'header', section: 0, which: 'default' });
    expect(header.story).toEqual({ kind: 'header', section: 0, which: 'default' });
    await editor.execute({ name: 'insertText', text: 'Quarterly' });
    expect(await selected(editor)).toBe('Quarterly');
    const back: EditorState = await editor.execute({ name: 'returnToBody' });
    expect(back.story).toEqual({ kind: 'body' });
    expect(await selected(editor)).toBe('body text');
  });

  it('refuses a first-page header in a section without a distinct title page', async () => {
    const editor: EditorSession = await open();
    await expect(editor.execute({ name: 'editHeaderFooter', furniture: 'footer', section: 0, which: 'firstPage' })).rejects.toThrow();
    expect(editor.state.story).toEqual({ kind: 'body' });
  });

  it('types a new footnote by going to it: insertNewFootnote leaves the caret in the body', async () => {
    const editor: EditorSession = await open();
    await editor.execute({ name: 'insertText', text: 'claim' });
    const inserted: EditorState = await editor.execute({ name: 'insertNewFootnote' });
    expect(inserted.story).toEqual({ kind: 'body' });
    const id: number = inserted.created[0].id;
    const note: EditorState = await editor.execute({ name: 'goToFootnote', id });
    expect(note.story).toEqual({ kind: 'footnote', id });
    await editor.execute({ name: 'insertText', text: 'Source.' });
    expect(await selected(editor)).toBe('Source.');
    expect((await editor.execute({ name: 'returnToBody' })).story).toEqual({ kind: 'body' });
  });

  it('opens a document that has a header in its body', async () => {
    const author: EditorSession = await open();
    await author.execute({ name: 'insertText', text: 'body' });
    await author.execute({ name: 'editHeaderFooter', furniture: 'header', section: 0, which: 'default' });
    await author.execute({ name: 'insertText', text: 'Header' });
    const docx: Uint8Array = (await author.exportAs({ format: 'docx' })).bytes;
    const reader: EditorSession = await open({ kind: 'bytes', bytes: docx, format: 'docx' });
    // The engine's own answer, not the opening state this side assumes.
    expect((await reader.execute({ name: 'moveCaret', granularity: 'char', forward: false, extend: false })).story).toEqual({ kind: 'body' });
    expect(await selected(reader)).toBe('body');
  });
});

describe('the list where the selection starts', () => {
  it('names a built-in list and its level, none outside a list, and mixed across both', async () => {
    const editor: EditorSession = await open();
    await editor.execute({ name: 'insertText', text: 'item' });
    const listed: EditorState = await editor.execute({ name: 'setNumberingKind', kind: 'upperRoman', level: 2 });
    expect(listed.caretFormatting.known && [listed.caretFormatting.list, listed.caretFormatting.listMixed]).toEqual([{ kind: 'upperRoman', level: 2 }, false]);
    await editor.execute({ name: 'splitParagraph' });
    const plain: EditorState = await editor.execute({ name: 'clearNumbering' });
    expect(plain.caretFormatting.known && plain.caretFormatting.list).toBeNull();
    const both: EditorState = await editor.execute({ name: 'selectAll' });
    expect(both.caretFormatting.known && both.caretFormatting.listMixed).toBe(true);
  });
});

describe('the v6 encodings', () => {
  it('writes the three new requests as the spec lays them out', () => {
    expect([...encodeCommand({ name: 'editHeaderFooter', furniture: 'footer', section: 2, which: 'evenPages' })]).toEqual([0x34, 1, 2, 2]);
    expect([...encodeCommand({ name: 'goToFootnote', id: 300 })]).toEqual([0x35, 0xac, 0x02]);
    expect([...encodeCommand({ name: 'returnToBody' })]).toEqual([0x36]);
  });

  it('reads each story', () => {
    const story = (...bytes: number[]): ReturnType<typeof readStory> => readStory(new RecordReader(Uint8Array.from(bytes)));
    expect(story(0)).toEqual({ kind: 'body' });
    expect(story(1, 3, 1)).toEqual({ kind: 'header', section: 3, which: 'firstPage' });
    expect(story(2, 0, 2)).toEqual({ kind: 'footer', section: 0, which: 'evenPages' });
    expect(story(3, 0xac, 0x02)).toEqual({ kind: 'footnote', id: 300 });
    expect(() => story(4)).toThrow(/unknown story 4/);
    expect(() => story(1, 0, 3)).toThrow(/unknown header or footer kind 3/);
  });

  it('reads the list: none, each built-in kind by its SetNumberingKind code, and 6 as custom', () => {
    const list = (...bytes: number[]): ReturnType<typeof readList> => readList(new RecordReader(Uint8Array.from(bytes)));
    expect(list(0)).toBeNull();
    expect(list(1, 1, 0)).toEqual({ kind: 'decimal', level: 0 });
    expect(list(1, 5, 8)).toEqual({ kind: 'upperRoman', level: 8 });
    expect(list(1, 6, 3)).toEqual({ kind: 'custom', level: 3 });
    expect(() => list(1, 7, 0)).toThrow(/unknown list kind 7/);
    expect(() => list(1, 0, 9)).toThrow(/list level 9/);
    expect(() => list(2)).toThrow(/list flag 2/);
  });

  it('reads what a remote update left waiting', () => {
    const remote = (...bytes: number[]): ReturnType<typeof readRemote> => readRemote(new RecordReader(Uint8Array.from(bytes)));
    expect(remote(0)).toBeNull();
    expect(remote(1, 0, 0)).toEqual({ missing: null, dropped: 0n });
    expect(remote(1, 1, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01, 7, 2)).toEqual({ missing: { client: 0xffff_ffff_ffff_ffffn, clock: 7n }, dropped: 2n });
    expect(() => remote(2)).toThrow(/remote flag 2/);
    expect(() => remote(1, 2, 0)).toThrow(/missing flag 2/);
  });
});
