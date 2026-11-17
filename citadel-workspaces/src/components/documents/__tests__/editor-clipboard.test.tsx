/**
 * The clipboard on the editor's textarea, as the browser delivers it (Ctrl/⌘+C, X and V are
 * the browser's own copy, cut and paste events there, so no key handler is involved). R1 has
 * text/plain only. jsdom has no ClipboardEvent or DataTransfer, so each event carries a
 * stand-in clipboardData.
 */
import { describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { key, mount, settled, statedViewport, type, type Mounted } from './editor-harness';

statedViewport();

interface Delivered {
  readonly event: Event;
  /** What the handler set on the event's clipboardData, by format. */
  readonly set: Map<string, string>;
}

function clipboardEvent(input: HTMLElement, type: 'paste' | 'copy' | 'cut', pasted: string): Delivered {
  const event: Event = new Event(type, { bubbles: true, cancelable: true });
  const set: Map<string, string> = new Map<string, string>();
  const clipboardData: Pick<DataTransfer, 'getData' | 'setData'> = {
    getData: (format: string): string => (format === 'text/plain' ? pasted : ''),
    setData: (format: string, data: string): void => { set.set(format, data); },
  };
  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  act(() => { input.dispatchEvent(event); });
  return { event, set };
}

const paste = (input: HTMLElement, text: string): Event => clipboardEvent(input, 'paste', text).event;

const caretX = (m: Mounted): number => m.editor.state.caret?.rect.x ?? Number.NaN;
const caretY = (m: Mounted): number => m.editor.state.caret?.rect.y ?? Number.NaN;

describe('pasting into the editor', () => {
  it('enters the clipboard text where the caret is, instead of the textarea taking it', async () => {
    const m: Mounted = await mount('worker');
    const start: number = caretX(m);
    const event: Event = paste(m.input, 'abc');
    await settled(m.editor);
    expect(event.defaultPrevented).toBe(true);
    expect(m.input.value).toBe('');
    const pasted: number = caretX(m);
    expect(pasted).toBeGreaterThan(start);
    key(m.input, 'z', { ctrlKey: true });
    await settled(m.editor);
    type(m.input, 'abc');
    await settled(m.editor);
    expect(caretX(m)).toBe(pasted);
    expect(m.errors).toEqual([]);
  });

  it('is one undo step of its own: undo takes the paste and keeps what was typed before it', async () => {
    const m: Mounted = await mount('worker');
    const start: number = caretX(m);
    type(m.input, 'x');
    await settled(m.editor);
    const typed: number = caretX(m);
    paste(m.input, 'pasted');
    await settled(m.editor);
    key(m.input, 'z', { ctrlKey: true });
    await settled(m.editor);
    expect(caretX(m)).toBe(typed);
    expect(typed).toBeGreaterThan(start);
  });

  it('reads Windows and old Mac line endings as paragraph breaks', async () => {
    const m: Mounted = await mount('worker');
    const firstLine: number = caretY(m);
    paste(m.input, 'one\ntwo');
    await settled(m.editor);
    const unix: number = caretY(m);
    expect(unix).toBeGreaterThan(firstLine);
    key(m.input, 'z', { ctrlKey: true });
    await settled(m.editor);
    paste(m.input, 'one\r\ntwo');
    await settled(m.editor);
    expect(caretY(m)).toBe(unix);
    key(m.input, 'z', { ctrlKey: true });
    await settled(m.editor);
    paste(m.input, 'one\rtwo');
    await settled(m.editor);
    expect(caretY(m)).toBe(unix);
  });

  it('ignores an empty clipboard', async () => {
    const m: Mounted = await mount('worker');
    const start: number = caretX(m);
    paste(m.input, '');
    await settled(m.editor);
    expect(caretX(m)).toBe(start);
    expect(m.errors).toEqual([]);
  });
});

const utf8: TextDecoder = new TextDecoder();
const documentText = async (m: Mounted): Promise<string> => utf8.decode((await m.editor.exportAs({ format: 'txt' })).bytes).trim();

describe('copying and cutting from the editor', () => {
  it('copies the selection as text/plain inside the event, and leaves a caret to the browser', async () => {
    const m: Mounted = await mount('worker');
    type(m.input, 'copy me');
    await settled(m.editor);
    const atCaret: Delivered = clipboardEvent(m.input, 'copy', '');
    expect(atCaret.event.defaultPrevented).toBe(false);
    expect(atCaret.set.size).toBe(0);
    key(m.input, 'a', { ctrlKey: true });
    await settled(m.editor);
    const copied: Delivered = clipboardEvent(m.input, 'copy', '');
    expect(copied.event.defaultPrevented).toBe(true);
    expect(copied.set.get('text/plain')).toBe('copy me');
    expect(await documentText(m)).toBe('copy me');
  });

  it('cuts: the text goes to the clipboard and out of the document, as one undo step', async () => {
    const m: Mounted = await mount('worker');
    type(m.input, 'cut me');
    key(m.input, 'a', { ctrlKey: true });
    await settled(m.editor);
    const cut: Delivered = clipboardEvent(m.input, 'cut', '');
    await settled(m.editor);
    expect(cut.set.get('text/plain')).toBe('cut me');
    expect(await documentText(m)).toBe('');
    key(m.input, 'z', { ctrlKey: true });
    await settled(m.editor);
    expect(await documentText(m)).toBe('cut me');
  });

  it('writes a selection past the record cap through the clipboard port, and says so when it is refused', async () => {
    const m: Mounted = await mount('worker');
    const long: string = 'x'.repeat(70_000);
    await act(async () => { await m.editor.execute({ name: 'insertText', text: long }); });
    key(m.input, 'a', { ctrlKey: true });
    await settled(m.editor);
    expect(m.editor.state.selectionText.complete).toBe(false);
    const copied: Delivered = clipboardEvent(m.input, 'copy', '');
    await settled(m.editor);
    await act(async () => { await Promise.resolve(); });
    expect(copied.event.defaultPrevented).toBe(true);
    expect(copied.set.size).toBe(0);
    expect(m.clipboard).toEqual([long]);
  });

  it('says so when the browser refuses the clipboard write', async () => {
    const m: Mounted = await mount('worker', { clipboard: 'refuses' });
    await act(async () => { await m.editor.execute({ name: 'insertText', text: 'y'.repeat(70_000) }); });
    key(m.input, 'a', { ctrlKey: true });
    await settled(m.editor);
    clipboardEvent(m.input, 'copy', '');
    await settled(m.editor);
    await act(async () => { await Promise.resolve(); });
    expect(m.errors.map((e: unknown) => (e as Error).message)).toEqual([
      'The selection could not be copied: the browser refused to write the clipboard (NotAllowedError: Write permission denied.).',
    ]);
  });
});
