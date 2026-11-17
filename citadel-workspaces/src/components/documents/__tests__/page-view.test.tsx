/**
 * The page view over the real cdoc wasm, with both renderers: the pages in view and one either
 * side are mounted and painted at once, the warm window around them is painted ahead one page
 * per idle tick (stepped by hand here), scrolling within it repaints nothing, zoom arrives from Ctrl+wheel
 * and the keyboard, and the column is a focusable region reporting "Page N of M". jsdom has no
 * layout, so the viewport height is stated (800px) rather than measured.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { inProcessRuntime, pmWithParagraphs, type TestRuntime } from '@/lib/cdoc/__tests__/wasm-rig';
import type { StaticSource } from '@/lib/cdoc/document-source';
import { PAGE_GAP_PX, PageView, type PageStatus } from '../PageView';
import { ManualFrames } from './manual-clock';
import { PAINT_AHEAD_MOUNTS_PER_TICK, PAINT_AHEAD_PAGES } from '@/lib/cdoc/paint/paint-config';

const VIEWPORT_PX: number = 800;
const LONG: StaticSource = { kind: 'pm', pmJson: pmWithParagraphs(60, 'Every page of this document is painted only while it is near the viewport. '.repeat(4)) };

let restore: (() => void) | null = null;
beforeEach(() => {
  const original: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => VIEWPORT_PX });
  restore = (): void => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'clientHeight', original);
  };
});
afterEach(() => restore?.());

function Harness({ runtime, dpr, statuses, idle }: { runtime: TestRuntime; dpr: number; statuses: PageStatus[]; idle: ManualFrames }): JSX.Element {
  const [zoom, setZoom] = useState<number>(1);
  return (
    <>
      <output data-testid="zoom">{zoom}</output>
      <PageView client={runtime.client} renderer={runtime.renderer} source={LONG} zoom={zoom} dpr={dpr} onZoomChange={setZoom} onPageStatus={(s) => statuses.push(s)}
        paintAhead={{ warmPages: PAINT_AHEAD_PAGES, mountsPerTick: PAINT_AHEAD_MOUNTS_PER_TICK, idle: idle.frame }} />
    </>
  );
}

const mountedPages = (): number[] => screen.queryAllByTestId('document-page').map((el) => Number(el.dataset.page));

describe.each(['worker', 'main-thread'] as const)('PageView with the %s renderer', (mode: 'worker' | 'main-thread') => {
  it('mounts and paints the pages in view and one either side, follows the scroll, and repaints none it keeps', async () => {
    const runtime: TestRuntime = inProcessRuntime(mode);
    const statuses: PageStatus[] = [];
    render(<Harness runtime={runtime} dpr={2} statuses={statuses} idle={new ManualFrames()} />);
    await waitFor(() => expect(mountedPages()).toEqual([0, 1]));
    const total: number = statuses[statuses.length - 1].total;
    expect(total).toBeGreaterThanOrEqual(5);
    await waitFor(() => expect(runtime.painted.filter((t) => t.sizes.length > 0)).toHaveLength(2));

    const region: HTMLElement = screen.getByRole('region', { name: 'Document pages' });
    const page: HTMLElement = screen.getAllByTestId('document-page')[0];
    const pitch: number = parseFloat(page.style.height) + PAGE_GAP_PX;
    region.scrollTop = PAGE_GAP_PX + 3 * pitch;
    fireEvent.scroll(region);
    // Page 3 in view: 2 to 4 at once, 1 kept (within two pages), 0 let go.
    await waitFor(() => expect(mountedPages()).toEqual([1, 2, 3, 4]));
    expect(statuses[statuses.length - 1]).toEqual({ current: 4, total });
    await waitFor(() => expect(runtime.painted.filter((t) => t.sizes.length > 0)).toHaveLength(5));
    expect(runtime.painted.map((t) => t.sizes.length)).toEqual([1, 1, 1, 1, 1]);
  });

  it('paints the warm window ahead one page per idle tick, nearest first, and stops at its edge', async () => {
    const runtime: TestRuntime = inProcessRuntime(mode);
    const idle: ManualFrames = new ManualFrames();
    render(<Harness runtime={runtime} dpr={1} statuses={[]} idle={idle} />);
    await waitFor(() => expect(mountedPages()).toEqual([0, 1]));
    await waitFor(() => expect(idle.pending).toBe(1));
    act(() => idle.run());
    await waitFor(() => expect(mountedPages()).toEqual([0, 1, 2]));
    await waitFor(() => expect(runtime.painted.filter((t) => t.sizes.length > 0)).toHaveLength(3));
    expect(idle.pending).toBe(0);
  });

  it('paints at the device pixel ratio it is given', async () => {
    const runtime: TestRuntime = inProcessRuntime(mode);
    render(<Harness runtime={runtime} dpr={2} statuses={[]} idle={new ManualFrames()} />);
    await waitFor(() => expect(runtime.painted[0]?.sizes.length).toBeGreaterThan(0));
    // A4 is 793.73 x 1122.53 CSS px at 100%: the canvas is the whole CSS size, 794 x 1123, at 2x.
    expect(runtime.painted[0].sizes[0]).toEqual([1588, 2246]);
    expect(screen.getAllByTestId('document-page')[0].style.width).toBe('794px');
    expect(screen.getAllByTestId('document-page')[0].style.height).toBe('1123px');
    // A page nobody edits keeps the default cursor; the editor's pages show the I-beam.
    expect(screen.getAllByTestId('document-page')[0].classList.contains('cursor-text')).toBe(false);
  });
});

describe('PageView zoom and focus', () => {
  it('is a focusable region labelled for each page', async () => {
    render(<Harness runtime={inProcessRuntime('main-thread')} dpr={1} statuses={[]} idle={new ManualFrames()} />);
    const region: HTMLElement = await screen.findByRole('region', { name: 'Document pages' });
    expect(region.tabIndex).toBe(0);
    expect(await screen.findByRole('group', { name: /^Page 1 of \d+$/ })).toBeInTheDocument();
  });

  it('zooms with Ctrl+wheel (and not with a plain wheel) and with Ctrl + = / − / 0', async () => {
    render(<Harness runtime={inProcessRuntime('main-thread')} dpr={1} statuses={[]} idle={new ManualFrames()} />);
    const region: HTMLElement = await screen.findByRole('region', { name: 'Document pages' });
    await waitFor(() => expect(mountedPages().length).toBeGreaterThan(0));
    act(() => { fireEvent.wheel(region, { deltaY: -100 }); });
    expect(screen.getByTestId('zoom')).toHaveTextContent(/^1$/);
    act(() => { fireEvent.wheel(region, { deltaY: -100, ctrlKey: true }); });
    expect(Number(screen.getByTestId('zoom').textContent)).toBeGreaterThan(1);
    fireEvent.keyDown(region, { key: '0', ctrlKey: true });
    expect(screen.getByTestId('zoom')).toHaveTextContent(/^1$/);
    fireEvent.keyDown(region, { key: '=', ctrlKey: true });
    expect(screen.getByTestId('zoom')).toHaveTextContent(/^1\.1$/);
    fireEvent.keyDown(region, { key: '-', metaKey: true });
    expect(screen.getByTestId('zoom')).toHaveTextContent(/^1$/);
  });
});
