/**
 * The editable page view over the real cdoc-edit, with both renderers (InProcessCdocClient:
 * production host, engine and wasm). Input arrives as the browser delivers it, beforeinput,
 * composition and key events on the hidden textarea and pointer presses on a page, and the
 * effects are read back from the engine (snapshot text via a repaint, selection, overlays).
 * jsdom has no layout, so the viewport height is stated (800px) and page boxes sit at 0,0.
 */
import { describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import type { Call } from '@/lib/cdoc/paint/__tests__/recording-canvas';
import type { PeerView } from '@/lib/cdoc/editor/controller';
import { key, mount, settled, statedViewport, type } from './editor-harness';

/** The pages the column has painted (on screen and one each side), from its canvases. */
const painted = (): number[] => screen.getAllByTestId('document-page').map((el: HTMLElement): number => Number(el.dataset.page)).sort((a, b) => a - b);

statedViewport();

const fills = (calls: readonly Call[]): number => calls.filter((c) => c.name === 'fillRect').length;

describe.each(['worker', 'main-thread'] as const)('EditorPageView with the %s renderer', (mode) => {
  it('types through beforeinput, moving the caret and repainting the page', async () => {
    const { runtime, editor, input, errors } = await mount(mode);
    const before: number = runtime.painted.reduce((n, t) => n + t.sizes.length, 0);
    type(input, 'Hello');
    await settled(editor);
    expect(errors).toEqual([]);
    expect(editor.state.caret?.rect.x).toBeGreaterThan(7200);
    await waitFor(() => expect(runtime.painted.reduce((n, t) => n + t.sizes.length, 0)).toBeGreaterThan(before));
  });

  it('repaints only the pages an edit dirtied', async () => {
    const { runtime, editor, input } = await mount(mode);
    await act(async () => { await editor.execute({ name: 'insertText', text: 'line\n'.repeat(70) }); });
    await waitFor(() => expect(screen.getAllByTestId('document-page').length).toBeGreaterThanOrEqual(2));
    await act(async () => { await editor.execute({ name: 'moveCaret', granularity: 'document', forward: false, extend: false }); });
    const pageTargets = (): number[] => runtime.painted.map((t) => t.sizes.length);
    await waitFor(() => expect(pageTargets().filter((n) => n > 0).length).toBeGreaterThanOrEqual(2));
    const before: number[] = pageTargets();
    type(input, 'q');
    await settled(editor);
    await waitFor(() => expect(pageTargets().some((n, i) => n > (before[i] ?? 0))).toBe(true));
    const grew: number = pageTargets().filter((n, i) => n > (before[i] ?? 0)).length;
    expect(grew).toBe(1);
  });

  it('keeps the textarea (and so an IME window) at the caret, without remounting it', async () => {
    const { editor, input } = await mount(mode);
    const anchor = (): number => parseFloat((input.parentElement as HTMLElement).style.left);
    const before: number = anchor();
    type(input, 'moves');
    await settled(editor);
    await waitFor(() => expect(anchor()).toBeGreaterThan(before));
    expect(screen.getByTestId('editor-input')).toBe(input);
  });

  it('maps Backspace and Ctrl+Z through the keymap', async () => {
    const { editor, input } = await mount(mode);
    type(input, 'ab');
    await settled(editor);
    const typed: number = editor.state.caret?.rect.x ?? 0;
    key(input, 'Backspace');
    await settled(editor);
    expect(editor.state.caret?.rect.x).toBeLessThan(typed);
    key(input, 'z', { ctrlKey: true });
    key(input, 'z', { ctrlKey: true });
    await settled(editor);
    expect(editor.state.caret?.rect.x).toBeLessThan(typed);
  });

  it('commits an IME composition as typed text', async () => {
    const { editor, input } = await mount(mode);
    const start: number = editor.state.caret?.rect.x ?? 0;
    act(() => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
      input.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'にほ', bubbles: true }));
      input.dispatchEvent(new CompositionEvent('compositionupdate', { data: '日本', bubbles: true }));
    });
    await settled(editor);
    expect(editor.state.composing).toBe(true);
    act(() => { input.dispatchEvent(new CompositionEvent('compositionend', { data: '日本', bubbles: true })); });
    await settled(editor);
    expect(editor.state.composing).toBe(false);
    expect(editor.state.caret?.rect.x).toBeGreaterThan(start);
  });

  it('ends the undo step on blur, so undo keeps what was typed before it', async () => {
    const { editor, input } = await mount(mode);
    type(input, 'keep');
    act(() => { input.dispatchEvent(new FocusEvent('blur')); });
    type(input, 'drop');
    await settled(editor);
    const both: number = editor.state.caret?.rect.x ?? 0;
    key(input, 'z', { ctrlKey: true });
    await settled(editor);
    const after: number = editor.state.caret?.rect.x ?? 0;
    expect(after).toBeLessThan(both);
    expect(after).toBeGreaterThan(7200);
  });

  it('selects a word on a double press and draws its highlight on the selection overlay', async () => {
    const { runtime, editor, input } = await mount(mode);
    type(input, 'alpha beta');
    await settled(editor);
    const page: HTMLElement = screen.getAllByTestId('document-page')[0];
    const css: number = 96 / 7200;
    act(() => {
      page.dispatchEvent(new MouseEvent('pointerdown', { button: 0, detail: 2, clientX: 7400 * css, clientY: 7300 * css, bubbles: true, cancelable: true }));
    });
    await settled(editor);
    await waitFor(() => expect(editor.state.selectionRects).toHaveLength(1));
    const selection: HTMLCanvasElement | null = page.querySelector('canvas[data-layer="selection"]');
    await waitFor(() => expect(fills(runtime.overlays.get(selection as HTMLCanvasElement)?.calls ?? [])).toBeGreaterThan(0));
  });

  it('draws the caret on its own overlay, and peers with their names on theirs', async () => {
    const { runtime, editor, input } = await mount(mode);
    type(input, 'x');
    await settled(editor);
    const view: PeerView = await editor.peerView(await editor.awareness());
    act(() => { editor.peers.setPeers([{ name: 'Ada', color: '#aa00ff', view: { ...view, client: 99n } }]); });
    const page: HTMLElement = screen.getAllByTestId('document-page')[0];
    const peers: HTMLCanvasElement | null = page.querySelector('canvas[data-layer="peers"]');
    const caret: HTMLCanvasElement | null = page.querySelector('canvas[data-layer="caret"]');
    await waitFor(() => {
      const calls: readonly Call[] = runtime.overlays.get(peers as HTMLCanvasElement)?.calls ?? [];
      expect(calls.some((c) => c.name === 'fillText' && c.args[0] === 'Ada')).toBe(true);
      // The peer's caret and its label box.
      expect(fills(calls)).toBeGreaterThanOrEqual(2);
      expect(fills(runtime.overlays.get(caret as HTMLCanvasElement)?.calls ?? [])).toBeGreaterThanOrEqual(1);
    });
  });

  it('tells the editor the pages on screen, so a long selection carries rects for those pages only', async () => {
    const { editor, frames } = await mount(mode);
    await act(async () => { await editor.execute({ name: 'insertText', text: 'line\n'.repeat(300) }); });
    await waitFor(() => expect(editor.state.pageCount).toBeGreaterThanOrEqual(5));
    // The painted pages are reported on the next frame.
    act(() => frames.run());
    await settled(editor);
    await act(async () => { await editor.execute({ name: 'selectAll' }); });
    const pagesWithRects = (): number[] => [...new Set(editor.state.selectionRects.map((r) => r.page))].sort((a, b) => a - b);
    await waitFor(() => expect(pagesWithRects()).toEqual(painted()));
    expect(pagesWithRects().length).toBeLessThan(editor.state.pageCount);
  });
});

describe('the hidden textarea', () => {
  it('opts out of writing assistants, spellcheck and the platform\'s autocorrection', async () => {
    const { input } = await mount('main-thread');
    for (const [name, value] of [
      ['data-gramm', 'false'], ['data-gramm_editor', 'false'], ['data-enable-grammarly', 'false'],
      ['spellcheck', 'false'], ['autocomplete', 'off'], ['autocorrect', 'off'], ['autocapitalize', 'off'],
    ] as const) expect(input.getAttribute(name), name).toBe(value);
  });
});
