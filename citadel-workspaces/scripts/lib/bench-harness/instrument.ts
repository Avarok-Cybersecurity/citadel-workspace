/**
 * What the harness measures that the page cannot show: when the document is painted. The editor
 * paints pages in the worker, so the browser protocol's stops (the page count shown, the second
 * animation frame after a keydown) may come before the paint. This records the epoch time of the
 * first animation frame after the first page paint (`firstPaintEpochMs`), and for each keydown,
 * from its `timeStamp`, the first animation frame after the first page paint issued once the
 * edit applied, the session's `change` (`painted`, ms; the citadel-docs adapter clears it).
 */
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import type { PaintOutcome } from '@/lib/cdoc/paint/page-rasterizer';
import type { PageRenderer } from '@/lib/cdoc/paint/page-renderer';
import type { PaintPriority } from '@/lib/cdoc/paint/paint-queue';

export interface BenchState {
  readonly painted: number[];
  firstPaintEpochMs: number | null;
}

export interface BenchWindow {
  __cdocBench?: BenchState;
}

interface Pending {
  readonly keyAt: number;
  changedAt: number | null;
}

export interface KeystrokePaint {
  /** The runtime's renderer, every call passed through; paints are watched. */
  readonly renderer: (inner: PageRenderer) => PageRenderer;
  /** Watches an opened session's edits; returns the teardown. */
  readonly session: (editor: EditorSession) => () => void;
}

export function keystrokePaint(win: Window & BenchWindow): KeystrokePaint {
  const painted: number[] = [];
  const state: BenchState = { painted, firstPaintEpochMs: null };
  win.__cdocBench = state;
  let firstPainted: boolean = false;
  let pending: Pending | null = null;
  win.addEventListener('keydown', (e: KeyboardEvent): void => {
    pending = { keyAt: e.timeStamp, changedAt: null };
  }, true);
  const settle = (issuedAt: number): void => {
    if (!firstPainted) {
      firstPainted = true;
      win.requestAnimationFrame((): void => {
        state.firstPaintEpochMs = win.performance.timeOrigin + win.performance.now();
      });
    }
    const p: Pending | null = pending;
    if (p === null || p.changedAt === null || issuedAt < p.changedAt) return;
    pending = null;
    win.requestAnimationFrame((): void => {
      painted.push(win.performance.now() - p.keyAt);
    });
  };
  return {
    renderer: (inner: PageRenderer): PageRenderer => ({
      mount: (slot: number, canvas: HTMLCanvasElement): Promise<void> => inner.mount(slot, canvas),
      unmount: (slot: number): void => inner.unmount(slot),
      reset: (): void => inner.reset(),
      invalidate: (pages: readonly number[]): Promise<void> => inner.invalidate(pages),
      paint: async (slot: number, pageNumber: number, zoom: number, dpr: number, priority: PaintPriority): Promise<PaintOutcome> => {
        const issuedAt: number = win.performance.now();
        const outcome: PaintOutcome = await inner.paint(slot, pageNumber, zoom, dpr, priority);
        settle(issuedAt);
        return outcome;
      },
    }),
    session: (editor: EditorSession): (() => void) => editor.on('change', (): void => {
      if (pending !== null && pending.changedAt === null) pending.changedAt = win.performance.now();
    }),
  };
}
