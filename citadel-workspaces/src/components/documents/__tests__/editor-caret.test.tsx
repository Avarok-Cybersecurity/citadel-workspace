/**
 * The caret as Word shows it, over the real cdoc-edit: it blinks while the document has focus,
 * shows at once on every keystroke, holds steady during a drag and for reduced motion, hides on
 * blur and under a selection, and the blink repaints nothing. Focus from the keyboard rings the
 * region; a click does not.
 */
import { describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { mount, settled, statedViewport, type, type Mounted } from './editor-harness';
import type { RecordingTarget } from '@/lib/cdoc/paint/__tests__/recording-canvas';

statedViewport();

const caretCanvas = (): HTMLCanvasElement => {
  const canvas: HTMLCanvasElement | null = screen.getAllByTestId('document-page')[0].querySelector('canvas[data-layer="caret"]');
  if (canvas === null) throw new Error('no caret overlay');
  return canvas;
};
const shown = (): boolean => caretCanvas().style.visibility === 'visible';
const pagePaints = (m: Mounted): number => m.runtime.painted.reduce((n: number, t: RecordingTarget) => n + t.calls.length, 0);
const overlayPaints = (m: Mounted): number => [...m.runtime.overlays.values()].reduce((n: number, r) => n + r.calls.length, 0);

describe.each(['worker', 'main-thread'] as const)('the caret, with the %s renderer', (mode: 'worker' | 'main-thread') => {
  it('blinks while focused, and the blink repaints neither the page nor an overlay', async () => {
    const m: Mounted = await mount(mode);
    act(() => m.input.focus());
    type(m.input, 'x');
    act(() => m.frames.run());
    await settled(m.editor);
    await waitFor(() => expect(shown()).toBe(true));
    expect(m.blink.running).toEqual([530]);
    const [page, overlays] = [pagePaints(m), overlayPaints(m)];
    act(() => m.blink.tick());
    expect(shown()).toBe(false);
    act(() => m.blink.tick());
    expect(shown()).toBe(true);
    expect([pagePaints(m), overlayPaints(m)]).toEqual([page, overlays]);
  });

  it('shows at once when a key is typed mid-blink', async () => {
    const m: Mounted = await mount(mode);
    act(() => m.input.focus());
    act(() => m.blink.tick());
    expect(shown()).toBe(false);
    type(m.input, 'y');
    await settled(m.editor);
    await waitFor(() => expect(shown()).toBe(true));
  });

  it('hides when the document loses focus, and stops blinking', async () => {
    const m: Mounted = await mount(mode);
    act(() => m.input.focus());
    await waitFor(() => expect(shown()).toBe(true));
    act(() => m.input.blur());
    expect(shown()).toBe(false);
    expect(m.blink.running).toEqual([]);
  });

  it('holds steady for reduced motion', async () => {
    const m: Mounted = await mount(mode, { reducedMotion: true });
    act(() => m.input.focus());
    await waitFor(() => expect(shown()).toBe(true));
    act(() => m.blink.tick());
    expect(shown()).toBe(true);
    expect(m.blink.running).toEqual([]);
  });

  it('holds steady while the button is down on the page, and blinks again after', async () => {
    const m: Mounted = await mount(mode);
    act(() => m.input.focus());
    const page: HTMLElement = screen.getAllByTestId('document-page')[0];
    act(() => { page.dispatchEvent(new MouseEvent('pointerdown', { button: 0, detail: 1, clientX: 100, clientY: 100, bubbles: true, cancelable: true })); });
    await settled(m.editor);
    expect(m.blink.running).toEqual([]);
    expect(shown()).toBe(true);
    act(() => { page.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })); });
    expect(m.blink.running).toEqual([530]);
  });

  it('draws no caret under a selection', async () => {
    const m: Mounted = await mount(mode);
    type(m.input, 'select me');
    await settled(m.editor);
    await act(async () => { await m.editor.execute({ name: 'selectAll' }); });
    await settled(m.editor);
    // A layer with nothing to draw holds no bitmap: sized 0×0, which also wipes what it held.
    expect([caretCanvas().width, caretCanvas().height]).toEqual([0, 0]);
  });

  it('gives the caret layer a page-sized bitmap while it draws the caret', async () => {
    const m: Mounted = await mount(mode);
    type(m.input, 'here');
    await settled(m.editor);
    expect(caretCanvas().width).toBeGreaterThan(0);
    const calls: readonly { readonly name: string }[] = m.runtime.overlays.get(caretCanvas())?.calls ?? [];
    expect(calls.map((c) => c.name)).toContain('fillRect');
  });
});

describe('the focus ring', () => {
  const region = (): HTMLElement => screen.getByRole('region', { name: 'Document pages' });

  it('rings the region when focus arrives from the keyboard', async () => {
    const m: Mounted = await mount('main-thread');
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); });
    act(() => m.input.focus());
    expect(region().dataset.focusRing).toBe('true');
    act(() => m.input.blur());
    expect(region().dataset.focusRing).toBeUndefined();
  });

  it('does not ring it for a click on the page', async () => {
    const m: Mounted = await mount('main-thread');
    act(() => { screen.getAllByTestId('document-page')[0].dispatchEvent(new MouseEvent('pointerdown', { button: 0, detail: 1, bubbles: true, cancelable: true })); });
    await settled(m.editor);
    expect(document.activeElement).toBe(m.input);
    expect(region().dataset.focusRing).toBeUndefined();
  });
});
