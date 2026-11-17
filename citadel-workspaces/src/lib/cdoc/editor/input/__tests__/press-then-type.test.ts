/**
 * A key typed right after a click lands where the click put the selection. The press hit-tests
 * and selects as one queued step (EditorController.selectAt); as two steps, a keystroke queued
 * between them ran first, at the old caret, and the selection then moved under it ("elloH").
 * Over a real EditorSession (in-process runtime, real cdoc-edit); the pointer's page lookup is
 * the one stand-in (jsdom lays nothing out), always the start of the first line.
 */
import { describe, expect, it } from 'vitest';
import { inProcessRuntime, type TestRuntime } from '../../../__tests__/wasm-rig';
import { createEditorOpener } from '../../editor-opener';
import type { EditorSession } from '../../editor-session';
import { attachPointer, type PagePoint } from '../pointer';

const START_OF_FIRST_LINE: PagePoint = { page: 0, x: 0, y: 7300 };

async function editorHolding(text: string): Promise<EditorSession> {
  const runtime: TestRuntime = inProcessRuntime('main-thread');
  let n: number = 1;
  const editor: EditorSession = await createEditorOpener({ client: runtime.client, renderer: runtime.renderer }, (b: Uint8Array): Uint8Array => b.map((): number => n++))({ kind: 'blank' });
  await editor.execute({ name: 'insertText', text });
  return editor;
}

async function pressThenType(editor: EditorSession, press: { readonly detail: number; readonly shiftKey: boolean }): Promise<string> {
  const surface: EventTarget = new EventTarget();
  const errors: unknown[] = [];
  const detach: () => void = attachPointer(surface, editor, {
    locate: (): PagePoint => START_OF_FIRST_LINE,
    onError: (e: unknown): void => { errors.push(e); },
    focus: (): void => undefined,
    onDragChange: (): void => undefined,
    autoScroll: { edgePx: 40, maxStepPx: 20, viewport: () => ({ top: 0, bottom: 1000 }), scrollBy: (): void => undefined, frame: (): (() => void) => (): void => undefined },
  });
  surface.dispatchEvent(new MouseEvent('pointerdown', { button: 0, ...press }));
  surface.dispatchEvent(new MouseEvent('pointerup'));
  // Not awaited: the key arrives while the press is still being answered.
  const typed: Promise<unknown> = editor.execute({ name: 'insertText', text: 'H' });
  await editor.execute({ name: 'insertText', text: 'ello' });
  await typed;
  detach();
  expect(errors).toEqual([]);
  return new TextDecoder().decode((await editor.exportAs({ format: 'txt' })).bytes).trim();
}

describe('a key typed right after a press', () => {
  it('follows a click: the caret moves first', async () => {
    expect(await pressThenType(await editorHolding(' world'), { detail: 1, shiftKey: false })).toBe('Hello world');
  });

  it('follows a Shift+click: the selection it extends is replaced', async () => {
    expect(await pressThenType(await editorHolding('replace me'), { detail: 1, shiftKey: true })).toBe('Hello');
  });

  it('follows a double click: the word it selects is replaced', async () => {
    expect(await pressThenType(await editorHolding('alpha beta'), { detail: 2, shiftKey: false })).toBe('Hello beta');
  });

  it('follows a triple click: the paragraph it selects is replaced', async () => {
    expect(await pressThenType(await editorHolding('a whole paragraph'), { detail: 3, shiftKey: false })).toBe('Hello');
  });
});
