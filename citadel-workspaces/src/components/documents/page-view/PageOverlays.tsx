/**
 * The selection and caret canvases over one page, painted on the main thread from the
 * editor's state and the peers collaboration hands it. Sized in device px exactly like the
 * page canvas, so a highlight and the glyphs under it use the same pixel grid.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { drawsCaret, drawsPeers, drawsSelection, paintCaretLayer, paintPeerLayer, paintSelectionLayer, type OverlayScene, type OverlayStyle } from '@/lib/cdoc/paint/overlay-painter';
import { OVERLAY_STYLE } from '@/lib/cdoc/paint/paint-config';
import { deviceScale, pageSizePx, type DeviceScale } from '@/lib/cdoc/paint/units';
import type { Ctx2D } from '@/lib/cdoc/paint/canvas-port';

/** A 2D context for an overlay canvas: the DOM's in the app, a recording one in tests. */
export type OverlayContextOf = (canvas: HTMLCanvasElement) => Ctx2D;

export interface PageOverlaysProps {
  /** The page's size in Pt100. */
  readonly width: number;
  readonly height: number;
  readonly scene: OverlayScene;
  readonly contextOf: OverlayContextOf;
  /** The local caret's blink phase: its canvas is shown or hidden, never repainted for it. */
  readonly caretShown: boolean;
}

type LayerPainter = (ctx: Ctx2D, width: number, height: number, scene: OverlayScene, style: OverlayStyle) => void;

/** Paints one layer at the page's device size, or, when it draws nothing, frees its bitmap (0×0). */
function layer(canvas: HTMLCanvasElement, draws: boolean, size: { readonly w: number; readonly h: number }, scene: OverlayScene, paint: LayerPainter, contextOf: OverlayContextOf): void {
  const w: number = draws ? size.w : 0;
  const h: number = draws ? size.h : 0;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  if (draws) paint(contextOf(canvas), w, h, scene, OVERLAY_STYLE);
}

export function PageOverlays({ width, height, scene, contextOf, caretShown }: PageOverlaysProps): JSX.Element {
  const selection: RefObject<HTMLCanvasElement> = useRef<HTMLCanvasElement>(null);
  const peers: RefObject<HTMLCanvasElement> = useRef<HTMLCanvasElement>(null);
  const caret: RefObject<HTMLCanvasElement> = useRef<HTMLCanvasElement>(null);
  // A scene is rebuilt on every render; it is repainted only when what it shows changes.
  const { page, selection: rects, caret: caretRect, peers: presences } = scene;
  const { zoom, dpr } = scene.scale;

  useLayoutEffect((): void => {
    const scale: DeviceScale = deviceScale(zoom, dpr);
    const now: OverlayScene = { page, scale, selection: rects, caret: caretRect, peers: presences };
    const size: { readonly w: number; readonly h: number } = pageSizePx(width, height, scale);
    if (selection.current === null || peers.current === null || caret.current === null) return;
    layer(selection.current, drawsSelection(now), size, now, paintSelectionLayer, contextOf);
    layer(peers.current, drawsPeers(now), size, now, paintPeerLayer, contextOf);
    layer(caret.current, drawsCaret(now), size, now, paintCaretLayer, contextOf);
  }, [width, height, page, zoom, dpr, rects, caretRect, presences, contextOf]);

  return (
    <>
      <canvas ref={selection} data-layer="selection" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
      <canvas ref={peers} data-layer="peers" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
      <canvas
        ref={caret} data-layer="caret" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ visibility: caretShown ? 'visible' : 'hidden' }}
      />
    </>
  );
}
