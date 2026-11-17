/**
 * The scrolling column of pages both page views share: lays the pages out, keeps the pages in
 * view and a warm window around them painted (use-warm-pages.ts), and handles zoom gestures. Zoom and DPR are the caller's
 * (explicit); Ctrl/⌘+wheel and Ctrl/⌘ +, −, 0 ask the caller to change zoom. The column is a
 * focusable region, so the keyboard scrolls it, and "Page N of M" goes to `onPageStatus`.
 * An editable view adds per-page repaint revisions and overlay scenes (`editing`).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import type { PageRenderer } from '@/lib/cdoc/paint/page-renderer';
import { deviceScale, type DeviceScale } from '@/lib/cdoc/paint/units';
import type { OverlayScene } from '@/lib/cdoc/paint/overlay-painter';
import type { PageRect } from '@/lib/cdoc/editor/controller';
import type { OverlayContextOf } from './PageOverlays';
import { PageCanvas } from './PageCanvas';
import { currentPage, deviceResidue, layoutPages, pageLeft, pagePointBy, revealScrollTop, type PageBox, type PageLayout } from './page-layout';
import { useWarmPages, type WarmPages } from './use-warm-pages';
import type { PaintAhead } from './warm-pages';
import type { PagePoint } from '@/lib/cdoc/editor/input/pointer';
import { INITIAL_ZOOM, zoomBySteps, zoomByWheel } from './zoom';

/** Space between pages and around the column, CSS px. */
export const PAGE_GAP_PX: number = 24;
/** Room kept between the caret and the viewport's top or bottom when it is scrolled into view, CSS px. */
const CARET_MARGIN_PX: number = 24;

export interface PageStatus {
  readonly current: number;
  readonly total: number;
}

export interface ColumnEditing {
  readonly revisionOf: (page: number) => number;
  readonly sceneOf: (page: number, scale: DeviceScale) => OverlayScene;
  readonly overlayContext: OverlayContextOf;
  /** The local caret: the hidden textarea sits there, so an IME's candidate window does too. */
  readonly caret: PageRect | null;
  /** The pages painted now (the visible ones and the warm ones around them), whenever that set changes. */
  readonly onPaintedPages: (pages: readonly number[]) => void;
  /** The local caret's blink phase. */
  readonly caretShown: boolean;
  /** Focus reached the document from the keyboard: the region shows its focus ring. */
  readonly focusRing: boolean;
  /** PageUp and PageDown: put the caret at a page point, extending the selection or not. */
  readonly moveCaretTo: (point: PagePoint, extend: boolean) => void;
}

export interface PageColumnProps {
  readonly renderer: PageRenderer;
  /** Width, height pairs in Pt100; null while the document opens. */
  readonly sizes: Int32Array | null;
  readonly zoom: number;
  readonly dpr: number;
  readonly onZoomChange: (zoom: number) => void;
  readonly onPageStatus: (status: PageStatus) => void;
  readonly scroller: RefObject<HTMLDivElement>;
  /** Null for a read-only view. */
  readonly editing: ColumnEditing | null;
  /** How far around the view pages stay painted, and when the ones ahead are painted. */
  readonly paintAhead: PaintAhead;
  /** Rendered inside the scrolling region (the editor's hidden textarea). */
  readonly children: ReactNode;
}

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Where the column starts on screen, CSS px: pages are placed so they land on device pixels. */
interface ColumnOrigin {
  readonly left: number;
  readonly top: number;
}

/** A page's top-left in the column, on whole device pixels of the screen. */
interface Placed {
  readonly box: PageBox;
  readonly left: number;
  readonly top: number;
}

function place(box: PageBox, columnWidth: number, origin: ColumnOrigin, dpr: number): Placed {
  return { box, left: pageLeft(columnWidth, box.width, origin.left, dpr), top: box.top + deviceResidue(origin.top, dpr) };
}

function caretBox(layout: PageLayout, caret: PageRect | null, columnWidth: number, origin: ColumnOrigin, dpr: number): Placed | undefined {
  const box: PageBox | undefined = caret === null ? undefined : layout.boxes[caret.page];
  return box === undefined ? undefined : place(box, columnWidth, origin, dpr);
}

function samePlace(a: PageRect | null, b: PageRect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.page === b.page && a.rect.x === b.rect.x && a.rect.y === b.rect.y && a.rect.height === b.rect.height;
}

function caretAnchor(placed: Placed | undefined, caret: PageRect | null, scale: DeviceScale): { top: number; left: number } {
  if (caret === null || placed === undefined) return { top: 0, left: 0 };
  return { top: placed.top + caret.rect.y * scale.css, left: placed.left + caret.rect.x * scale.css };
}

export function PageColumn({ renderer, sizes, zoom, dpr, onZoomChange, onPageStatus, scroller, editing, paintAhead, children }: PageColumnProps): JSX.Element {
  const [viewport, setViewport] = useState<{ readonly top: number; readonly height: number; readonly width: number }>({ top: 0, height: 0, width: 0 });
  const column: RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<ColumnOrigin>({ left: 0, top: 0 });
  const zoomRef: MutableRefObject<number> = useRef<number>(zoom);
  const pageKeys: MutableRefObject<((event: KeyboardEvent) => boolean) | null> = useRef<((event: KeyboardEvent) => boolean) | null>(null);
  const lastZoom: MutableRefObject<number> = useRef<number>(zoom);
  const opening: boolean = sizes === null;

  const layout: PageLayout | null = useMemo(
    () => (sizes === null ? null : layoutPages(sizes, deviceScale(zoom, dpr), PAGE_GAP_PX)),
    [sizes, zoom, dpr],
  );

  const measure: () => void = useCallback((): void => {
    const el: HTMLDivElement | null = scroller.current;
    if (el !== null) setViewport({ top: el.scrollTop, height: el.clientHeight, width: el.clientWidth });
    const rect: DOMRect | undefined = column.current?.getBoundingClientRect();
    if (rect !== undefined) {
      setOrigin((was: ColumnOrigin): ColumnOrigin => (was.left === rect.left && was.top === rect.top ? was : { left: rect.left, top: rect.top }));
    }
  }, [scroller]);

  useLayoutEffect((): void => {
    const el: HTMLDivElement | null = scroller.current;
    if (el !== null && lastZoom.current !== zoom) {
      // Keep the same part of the document under the viewport's middle while zooming.
      const middle: number = el.scrollTop + el.clientHeight / 2;
      el.scrollTop = Math.max(0, (middle * zoom) / lastZoom.current - el.clientHeight / 2);
    }
    lastZoom.current = zoom;
    zoomRef.current = zoom;
    measure();
  }, [zoom, measure, layout, scroller]);

  useEffect((): (() => void) | undefined => {
    const el: HTMLDivElement | null = scroller.current;
    if (el === null) return undefined;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      onZoomChange(zoomByWheel(zoomRef.current, event.deltaY));
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (pageKeys.current?.(event) === true) {
        event.preventDefault();
        return;
      }
      if (!event.ctrlKey && !event.metaKey) return;
      const next: number | null = event.key === '=' || event.key === '+' ? zoomBySteps(zoomRef.current, 1)
        : event.key === '-' ? zoomBySteps(zoomRef.current, -1)
        : event.key === '0' ? INITIAL_ZOOM : null;
      if (next === null) return;
      event.preventDefault();
      onZoomChange(next);
    };
    const resize: ResizeObserver = new ResizeObserver(measure);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('keydown', onKeyDown);
    resize.observe(el);
    return (): void => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKeyDown);
      resize.disconnect();
    };
  }, [onZoomChange, measure, scroller, opening]);

  const total: number = layout?.boxes.length ?? 0;
  const current: number = layout === null ? 0 : currentPage(layout, viewport.top, viewport.height);
  useEffect((): void => {
    if (total > 0) onPageStatus({ current: current + 1, total });
  }, [current, total, onPageStatus]);

  const caret: PageRect | null = editing?.caret ?? null;
  const moveCaretTo: ((point: PagePoint, extend: boolean) => void) | null = editing?.moveCaretTo ?? null;
  pageKeys.current = (event: KeyboardEvent): boolean => {
    const el: HTMLDivElement | null = scroller.current;
    if ((event.key !== 'PageUp' && event.key !== 'PageDown') || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (el === null || layout === null || caret === null || moveCaretTo === null) return false;
    const delta: number = (event.key === 'PageDown' ? 1 : -1) * el.clientHeight;
    const to: PagePoint | null = pagePointBy(layout, { page: caret.page, x: caret.rect.x, y: caret.rect.y }, delta, deviceScale(zoom, dpr).css);
    if (to === null) return false;
    el.scrollTop = Math.max(0, el.scrollTop + delta);
    moveCaretTo(to, event.shiftKey);
    return true;
  };

  // The caret stays in view after every command: a move that takes it off screen scrolls to it.
  // Only a caret that moved does; a zoom, a relayout, or a state that left it where it was (every
  // viewport report answers with one) under a caret the person scrolled away from does not.
  const revealed: MutableRefObject<PageRect | null> = useRef<PageRect | null>(null);
  useEffect((): void => {
    if (samePlace(revealed.current, caret)) return;
    revealed.current = caret;
    const el: HTMLDivElement | null = scroller.current;
    const box: PageBox | undefined = caret === null || layout === null ? undefined : layout.boxes[caret.page];
    if (el === null || caret === null || box === undefined) return;
    const css: number = deviceScale(zoom, dpr).css;
    const top: number = box.top + caret.rect.y * css;
    const to: number | null = revealScrollTop(top, top + caret.rect.height * css, el.scrollTop, el.clientHeight, CARET_MARGIN_PX);
    if (to !== null) el.scrollTop = to;
  }, [caret, layout, zoom, dpr, scroller]);

  const [paintError, setPaintError] = useState<string | null>(null);
  const onPaintError: (error: unknown) => void = useCallback((error: unknown): void => setPaintError(messageOf(error)), []);

  const warm: WarmPages = useWarmPages(layout, viewport.top, viewport.height, paintAhead);
  const painted: readonly PageBox[] = layout === null ? [] : warm.pages.map((n: number) => layout.boxes[n]);
  const columnWidth: number = Math.max(layout?.width ?? 0, viewport.width);
  const paintedKey: string = painted.map((box: PageBox): number => box.pageNumber).join(',');
  const onPaintedPages: ((pages: readonly number[]) => void) | null = editing?.onPaintedPages ?? null;
  useEffect((): void => {
    if (onPaintedPages !== null && paintedKey !== '') onPaintedPages(paintedKey.split(',').map(Number));
  }, [onPaintedPages, paintedKey]);
  return (
    <div
      ref={scroller}
      role="region"
      aria-label="Document pages"
      aria-busy={opening}
      tabIndex={0}
      data-testid="page-view"
      onScroll={measure}
      data-focus-ring={editing?.focusRing === true ? 'true' : undefined}
      className="relative h-full min-h-0 flex-1 overflow-auto bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[focus-ring=true]:ring-2 data-[focus-ring=true]:ring-inset data-[focus-ring=true]:ring-ring"
    >
      {layout === null && children}
      {paintError !== null && <p role="alert" className="sticky top-0 z-10 bg-background p-2 text-sm text-destructive">A page could not be painted. {paintError}</p>}
      {layout !== null && (
        <div ref={column} className="relative" style={{ width: columnWidth, height: layout.height }}>
          {painted.map((box: PageBox) => (
            <PageCanvas
              key={box.pageNumber} renderer={renderer} placed={place(box, columnWidth, origin, dpr)} zoom={zoom} dpr={dpr} pageCount={total}
              onPaintError={onPaintError} revision={editing?.revisionOf(box.pageNumber) ?? 0} priority={warm.visible.has(box.pageNumber) ? 'visible' : 'ahead'}
              overlay={editing === null || sizes === null ? null : {
                width: sizes[2 * box.pageNumber], height: sizes[2 * box.pageNumber + 1],
                scene: editing.sceneOf(box.pageNumber, deviceScale(zoom, dpr)), contextOf: editing.overlayContext, caretShown: editing.caretShown,
              }}
            />
          ))}
          {/* Always mounted here once laid out, so the textarea never remounts (and never drops
              focus or its listeners) as the caret comes and goes; it only moves. */}
          <div className="pointer-events-none absolute" style={caretAnchor(caretBox(layout, caret, columnWidth, origin, dpr), caret, deviceScale(zoom, dpr))}>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
