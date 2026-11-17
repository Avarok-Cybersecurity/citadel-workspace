/**
 * What an editable page view adds to a static one: the hidden textarea that takes the keyboard
 * (IME bridge), pointer selection over the pages, per-page repaint revisions bumped by the
 * editor's `pages` events (only dirty pages repaint), the page sizes as they change, and the
 * overlay scene (local selection, caret, peers) for each page, with the caret's blink, the
 * keyboard focus ring and PageUp/PageDown caret moves.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import type { EditorEvents, EditorState, PageRect } from '@/lib/cdoc/editor/controller';
import type { PeerPresence } from '@/lib/cdoc/editor/peer-overlay';
import { attachImeBridge } from '@/lib/cdoc/editor/input/ime-bridge';
import { viewportReporter } from '@/lib/cdoc/editor/viewport-reporter';
import { attachPointer, type PagePoint } from '@/lib/cdoc/editor/input/pointer';
import type { Platform } from '@/lib/cdoc/editor/input/keymap';
import type { OverlayScene } from '@/lib/cdoc/paint/overlay-painter';
import type { DeviceScale } from '@/lib/cdoc/paint/units';
import type { OverlayContextOf } from './PageOverlays';
import { useCaretBlink, type CaretBlinkOptions } from './use-caret-blink';
import { useEditorFocus, type EditorFocus } from './use-editor-focus';

/** A drag held within this many CSS px of the viewport's top or bottom scrolls it. */
const AUTO_SCROLL_EDGE_PX: number = 40;
/** The scroll per frame at the very edge, CSS px (about 1200 px/s at 60 fps). */
const AUTO_SCROLL_MAX_STEP_PX: number = 20;

export interface EditorSurfaceOptions {
  readonly platform: Platform;
  readonly overlayContext: OverlayContextOf;
  readonly undoPauseMs: number;
  readonly onError: (error: unknown) => void;
  readonly writeClipboard: (text: string) => Promise<void>;
  readonly caretBlink: CaretBlinkOptions;
  /** Runs a task on the next frame (requestAnimationFrame in the app); the result cancels it. */
  readonly frame: (task: () => void) => () => void;
}

export interface EditorSurface {
  readonly overlayContext: OverlayContextOf;
  readonly caret: PageRect | null;
  readonly textarea: RefObject<HTMLTextAreaElement>;
  readonly pageSizes: Int32Array;
  readonly revisionOf: (page: number) => number;
  readonly sceneOf: (page: number, scale: DeviceScale) => OverlayScene;
  readonly state: EditorState;
  readonly onPaintedPages: (pages: readonly number[]) => void;
  readonly caretShown: boolean;
  readonly focusRing: boolean;
  readonly moveCaretTo: (point: PagePoint, extend: boolean) => void;
}

/** What identifies where the caret is: a new key restarts its blink; a state that left it in place does not. */
function caretKey(state: EditorState): string {
  const c: PageRect | null = state.caret;
  return `${state.anchor.join(',')}|${state.head.join(',')}|${c === null ? '-' : `${c.page}:${c.rect.x}:${c.rect.y}:${c.rect.height}`}`;
}

/**
 * The page element under a client point: the event's own target, else (a captured drag reports
 * the surface) whatever is under the point, else the page nearest it vertically, so a drag past
 * the last line or between pages keeps selecting.
 */
function pageUnder(surface: Element, target: EventTarget | null, clientX: number, clientY: number): Element | null {
  const own: Element | null = target instanceof Element ? target.closest('[data-page]') : null;
  if (own !== null) return own;
  const doc: Document = surface.ownerDocument;
  const hit: Element | null = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(clientX, clientY) : null;
  const under: Element | null = hit?.closest('[data-page]') ?? null;
  if (under !== null && surface.contains(under)) return under;
  let nearest: Element | null = null;
  let best: number = Number.POSITIVE_INFINITY;
  for (const page of surface.querySelectorAll('[data-page]')) {
    const r: DOMRect = page.getBoundingClientRect();
    const d: number = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
    if (d < best) [nearest, best] = [page, d];
  }
  return nearest;
}

/** The page under a client point, in Pt100 page space, from the page element's box, clamped onto the page. */
function locator(surface: Element, scale: () => DeviceScale): (target: EventTarget | null, clientX: number, clientY: number) => PagePoint | null {
  return (target: EventTarget | null, clientX: number, clientY: number): PagePoint | null => {
    const el: Element | null = pageUnder(surface, target, clientX, clientY);
    if (el === null) return null;
    const page: number = Number((el as HTMLElement).dataset.page);
    const box: DOMRect = el.getBoundingClientRect();
    const css: number = scale().css;
    const clamp = (v: number, size: number): number => Math.round(Math.min(Math.max(0, v), size) / css);
    return { page, x: clamp(clientX - box.left, box.width), y: clamp(clientY - box.top, box.height) };
  };
}

export function useEditorSurface(editor: EditorSession, scroller: RefObject<HTMLDivElement>, scale: DeviceScale, options: EditorSurfaceOptions): EditorSurface {
  const textarea: RefObject<HTMLTextAreaElement> = useRef<HTMLTextAreaElement>(null);
  const [state, setState] = useState<EditorState>(editor.state);
  const [pageSizes, setPageSizes] = useState<Int32Array>(editor.pageSizes);
  const [revisions, setRevisions] = useState<ReadonlyMap<number, number>>(new Map<number, number>());
  const [peers, setPeers] = useState<readonly PeerPresence[]>(editor.peers.current);
  const scaleRef: { current: DeviceScale } = useRef<DeviceScale>(scale);
  scaleRef.current = scale;
  const { platform, undoPauseMs, onError, writeClipboard, frame } = options;
  const focusState: EditorFocus = useEditorFocus(textarea);
  const [dragging, setDragging] = useState<boolean>(false);
  const caretShown: boolean = useCaretBlink(options.caretBlink, focusState.focused, dragging, caretKey(state));

  useEffect((): (() => void) => {
    const offPages: () => void = editor.on('pages', (e: EditorEvents['pages']): void => {
      setPageSizes(editor.pageSizes);
      setRevisions((prev: ReadonlyMap<number, number>): ReadonlyMap<number, number> => {
        const next: Map<number, number> = new Map<number, number>(prev);
        for (const page of e.dirtyPages) next.set(page, (next.get(page) ?? 0) + 1);
        return next;
      });
    });
    const offSelection: () => void = editor.on('selection', setState);
    const offPeers: () => void = editor.peers.subscribe((): void => setPeers(editor.peers.current));
    return (): void => {
      offPages();
      offSelection();
      offPeers();
    };
  }, [editor]);

  useEffect((): (() => void) | undefined => {
    const sink: HTMLTextAreaElement | null = textarea.current;
    const surface: HTMLDivElement | null = scroller.current;
    if (sink === null || surface === null) return undefined;
    const focus = (): void => sink.focus({ preventScroll: true });
    editor.attachFocus(focus);
    const detachIme: () => void = attachImeBridge(sink, editor, { platform, pauseMs: undoPauseMs, onError, writeClipboard });
    const detachPointer: () => void = attachPointer(surface, editor, {
      locate: locator(surface, () => scaleRef.current), onError, focus, onDragChange: setDragging,
      autoScroll: {
        edgePx: AUTO_SCROLL_EDGE_PX, maxStepPx: AUTO_SCROLL_MAX_STEP_PX, frame,
        viewport: (): { top: number; bottom: number } => {
          const r: DOMRect = surface.getBoundingClientRect();
          return { top: r.top, bottom: r.top + surface.clientHeight };
        },
        scrollBy: (dy: number): void => { surface.scrollTop += dy; },
      },
    });
    return (): void => {
      detachIme();
      detachPointer();
      editor.attachFocus(null);
    };
  }, [editor, scroller, platform, undoPauseMs, onError, writeClipboard, frame]);

  const onPaintedPages: (pages: readonly number[]) => void = useMemo(() => viewportReporter(
    (pages: readonly number[]): void => { editor.setViewport(pages).catch(onError); },
    (task: () => void): void => { frame(task); },
  ), [editor, onError, frame]);

  // Rects come only for the pages on screen; a selection with none here is off screen, and so
  // is its caret's page, so treating it as collapsed draws nothing extra.
  const collapsed: boolean = state.selectionRects.length === 0;
  return {
    overlayContext: options.overlayContext,
    caret: state.caret,
    textarea,
    pageSizes,
    state,
    onPaintedPages,
    caretShown,
    focusRing: focusState.focusRing,
    moveCaretTo: (point: PagePoint, extend: boolean): void => {
      const anchor: EditorState['anchor'] = editor.state.anchor;
      editor
        .hitTest(point.page, point.x, point.y)
        .then((head: EditorState['head']) => editor.execute({ name: 'setSelection', anchor: extend ? anchor : head, head }))
        .catch(onError);
    },
    revisionOf: (page: number): number => revisions.get(page) ?? 0,
    sceneOf: (page: number, s: DeviceScale): OverlayScene => ({
      page, scale: s, selection: state.selectionRects, caret: collapsed ? state.caret : null, peers,
    }),
  };
}
