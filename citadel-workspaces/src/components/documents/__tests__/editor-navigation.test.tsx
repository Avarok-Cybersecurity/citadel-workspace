/**
 * Moving through a document as Word does, over the real cdoc-edit: the caret is scrolled into
 * view after a command takes it off screen, PageDown and PageUp move it (and the view) a screen
 * at a time, Shift extending, and a drag held at the viewport's edge scrolls. jsdom has no
 * layout: the viewport is 800px tall at the top of the window and pages are laid out by
 * layoutPages from the editor's page sizes, as the column lays them out.
 */
import { describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { key, mount, settled, statedViewport, type Mounted } from './editor-harness';
import { layoutPages, type PageLayout } from '../page-view/page-layout';
import { PAGE_GAP_PX } from '../page-view/PageColumn';
import { deviceScale, type DeviceScale } from '@/lib/cdoc/paint/units';
import type { EditorState, PageRect } from '@/lib/cdoc/editor/controller';

statedViewport();
const VIEWPORT: number = 800;
const SCALE: DeviceScale = deviceScale(1, 1);

const region = (): HTMLElement => screen.getByRole('region', { name: 'Document pages' });
/** The caret's top in the column, CSS px. */
function caretTop(m: Mounted): number {
  const caret: PageRect | null = m.editor.state.caret;
  if (caret === null) throw new Error('no caret');
  const layout: PageLayout = layoutPages(m.editor.pageSizes, SCALE, PAGE_GAP_PX);
  return layout.boxes[caret.page].top + caret.rect.y * SCALE.css;
}
async function longDocument(m: Mounted): Promise<void> {
  await act(async () => { await m.editor.execute({ name: 'insertText', text: 'line\n'.repeat(150) }); });
  await settled(m.editor);
}

describe('the caret stays in view', () => {
  it('scrolls to the caret when a command takes it off screen, and back with Ctrl+Home', async () => {
    const m: Mounted = await mount('main-thread');
    await longDocument(m);
    await waitFor(() => expect(region().scrollTop).toBeGreaterThan(VIEWPORT));
    const top: number = caretTop(m);
    expect(top).toBeGreaterThanOrEqual(region().scrollTop);
    expect(top).toBeLessThanOrEqual(region().scrollTop + VIEWPORT);
    key(m.input, 'Home', { ctrlKey: true });
    await settled(m.editor);
    await waitFor(() => expect(region().scrollTop).toBeLessThanOrEqual(caretTop(m)));
    expect(caretTop(m)).toBeLessThan(VIEWPORT);
  });

  it('lets the person scroll away from a caret that has not moved', async () => {
    const m: Mounted = await mount('main-thread');
    // Long enough that the first page leaves the painted window (the view and two pages around it).
    await act(async () => { await m.editor.execute({ name: 'insertText', text: 'line\n'.repeat(400) }); });
    await settled(m.editor);
    key(m.input, 'Home', { ctrlKey: true });
    // A selected first line: its rectangles are drawn only for the pages in view, so the answer
    // to a viewport report is a new state (without them) whose caret has not moved. A caret
    // alone would get no new state at all (a-result-that-changes-nothing-tells-no-one).
    key(m.input, 'End', { shiftKey: true });
    await settled(m.editor);
    await waitFor(() => expect(caretTop(m)).toBeLessThan(region().scrollTop + VIEWPORT));
    const away: number = region().scrollTop + 8 * VIEWPORT;
    const before: EditorState = m.editor.state;
    expect(before.selectionRects).not.toEqual([]);
    act(() => {
      region().scrollTop = away;
      region().dispatchEvent(new Event('scroll'));
    });
    // The pages in view change, so the editor is told and answers with a new state whose caret
    // is where it was: that answer must not scroll the view back to it.
    act(() => m.frames.run());
    await waitFor(() => expect(m.editor.state).not.toBe(before));
    await settled(m.editor);
    expect(m.editor.state.caret).toEqual(before.caret);
    expect(region().scrollTop).toBe(away);
  });
});

describe('PageDown and PageUp', () => {
  it('move the caret and the view a screen at a time, and Shift extends', async () => {
    const m: Mounted = await mount('main-thread');
    await longDocument(m);
    key(m.input, 'Home', { ctrlKey: true });
    await settled(m.editor);
    const from: number = caretTop(m);
    const scrolled: number = region().scrollTop;
    key(m.input, 'PageDown');
    await settled(m.editor);
    await waitFor(() => expect(caretTop(m)).toBeGreaterThan(from + VIEWPORT - 40));
    expect(caretTop(m)).toBeLessThan(from + VIEWPORT + 40);
    // A screen down, less the room the caret is kept from the top edge.
    expect(region().scrollTop).toBeGreaterThanOrEqual(scrolled + VIEWPORT - 40);
    expect(m.editor.state.selectionRects).toEqual([]);
    key(m.input, 'PageUp', { shiftKey: true });
    await settled(m.editor);
    await waitFor(() => expect(m.editor.state.selectionRects.length).toBeGreaterThan(0));
    expect(Math.abs(caretTop(m) - from)).toBeLessThan(40);
  });
});

describe('a drag held at the viewport edge', () => {
  it('scrolls a frame at a time, faster nearer the edge, until the button is released', async () => {
    const m: Mounted = await mount('main-thread');
    await longDocument(m);
    region().scrollTop = 0;
    const page: HTMLElement = screen.getAllByTestId('document-page')[0];
    act(() => { page.dispatchEvent(new MouseEvent('pointerdown', { button: 0, detail: 1, clientX: 100, clientY: 100, bubbles: true, cancelable: true })); });
    await settled(m.editor);
    act(() => { page.dispatchEvent(new MouseEvent('pointermove', { buttons: 1, clientX: 100, clientY: VIEWPORT - 5, bubbles: true })); });
    act(() => m.frames.run());
    const once: number = region().scrollTop;
    // 35 of the 40 px edge band deep: 35 / 40 of the 20 px a frame at the very edge.
    expect(once).toBeCloseTo(17.5, 5);
    act(() => m.frames.run());
    expect(region().scrollTop).toBeCloseTo(35, 5);
    act(() => { page.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })); });
    act(() => m.frames.run());
    expect(region().scrollTop).toBeCloseTo(35, 5);
  });

  it('does not scroll away from the edges', async () => {
    const m: Mounted = await mount('main-thread');
    await longDocument(m);
    region().scrollTop = 0;
    const page: HTMLElement = screen.getAllByTestId('document-page')[0];
    act(() => { page.dispatchEvent(new MouseEvent('pointerdown', { button: 0, detail: 1, clientX: 100, clientY: 100, bubbles: true, cancelable: true })); });
    await settled(m.editor);
    act(() => { page.dispatchEvent(new MouseEvent('pointermove', { buttons: 1, clientX: 100, clientY: VIEWPORT / 2, bubbles: true })); });
    act(() => m.frames.run());
    expect(region().scrollTop).toBe(0);
  });

  it('shows the I-beam over the pages it edits', async () => {
    await mount('main-thread');
    expect(screen.getAllByTestId('document-page')[0].classList.contains('cursor-text')).toBe(true);
  });
});
