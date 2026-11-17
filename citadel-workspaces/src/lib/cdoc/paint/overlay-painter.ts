/**
 * The three overlay canvases over a page: selection highlights underneath, peers' carets and
 * name labels above them, and the local caret on top, alone on its canvas so its blink only
 * shows and hides that canvas. Main thread, sized like the page canvas (device px), repainted whole on every
 * selection or peer change, which is cheap: a few rectangles. Rectangles follow units.ts's one
 * rounding rule, so a highlight lines up with the text the page canvas drew.
 */
import type { PageRect } from '../editor/controller';
import type { PeerPresence } from '../editor/peer-overlay';
import { rectPx, type DeviceScale, type PixelRect } from './units';
import type { Ctx2D } from './canvas-port';

export interface OverlayStyle {
  /** The local selection's fill (the document's paper is white in either theme). */
  readonly selection: string;
  readonly caret: string;
  /** Caret width in CSS px; at least one device pixel is drawn. */
  readonly caretCssPx: number;
  /** Alpha of a peer's selection fill, its caret drawn opaque in its colour. */
  readonly peerSelectionAlpha: number;
  /** The peer label's font size in CSS px and its family; drawn at device resolution. */
  readonly labelCssPx: number;
  readonly labelFamily: string;
  readonly labelText: string;
}

export interface OverlayScene {
  readonly page: number;
  readonly scale: DeviceScale;
  readonly selection: readonly PageRect[];
  /** Null when there is no caret, or it is on another page, or the selection is not collapsed. */
  readonly caret: PageRect | null;
  readonly peers: readonly PeerPresence[];
}

const onPage = (page: number): ((r: PageRect) => boolean) => (r: PageRect): boolean => r.page === page;

function fillRect(ctx: Ctx2D, r: PageRect, k: number): void {
  const p: PixelRect = rectPx({ x: r.rect.x, y: r.rect.y, w: r.rect.width, h: r.rect.height }, k);
  ctx.fillRect(p.x, p.y, p.w, p.h);
}

function caretAt(ctx: Ctx2D, r: PageRect, scale: DeviceScale, cssPx: number): { x: number; y: number } {
  const p: PixelRect = rectPx({ x: r.rect.x, y: r.rect.y, w: 0, h: r.rect.height }, scale.k);
  const w: number = Math.max(1, Math.round(cssPx * scale.dpr));
  ctx.fillRect(p.x - Math.floor(w / 2), p.y, w, p.h);
  return { x: p.x, y: p.y };
}

/**
 * Whether each layer draws anything on its page. A layer that draws nothing keeps no backing
 * store at all (PageOverlays sizes it 0×0), so a page scrolled into view allocates and clears
 * no full-page bitmaps for an empty selection, no peers and a caret elsewhere.
 */
export function drawsSelection(scene: OverlayScene): boolean {
  return scene.selection.some(onPage(scene.page)) || scene.peers.some((p: PeerPresence): boolean => p.view.selectionRects.some(onPage(scene.page)));
}

export function drawsPeers(scene: OverlayScene): boolean {
  return scene.peers.some((p: PeerPresence): boolean => p.view.caret !== null && p.view.caret.page === scene.page);
}

export function drawsCaret(scene: OverlayScene): boolean {
  return scene.caret !== null && scene.caret.page === scene.page;
}

export function paintSelectionLayer(ctx: Ctx2D, width: number, height: number, scene: OverlayScene, style: OverlayStyle): void {
  ctx.clearRect(0, 0, width, height);
  for (const peer of scene.peers) {
    ctx.globalAlpha = style.peerSelectionAlpha;
    ctx.fillStyle = peer.color;
    for (const r of peer.view.selectionRects.filter(onPage(scene.page))) fillRect(ctx, r, scene.scale.k);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = style.selection;
  for (const r of scene.selection.filter(onPage(scene.page))) fillRect(ctx, r, scene.scale.k);
}

export function paintPeerLayer(ctx: Ctx2D, width: number, height: number, scene: OverlayScene, style: OverlayStyle): void {
  ctx.clearRect(0, 0, width, height);
  for (const peer of scene.peers) {
    const caret: PageRect | null = peer.view.caret;
    if (caret === null || caret.page !== scene.page) continue;
    ctx.fillStyle = peer.color;
    const at: { x: number; y: number } = caretAt(ctx, caret, scene.scale, style.caretCssPx);
    ctx.font = `600 ${Math.round(style.labelCssPx * scene.scale.dpr)}px ${style.labelFamily}`;
    ctx.textBaseline = 'bottom';
    const pad: number = Math.round(2 * scene.scale.dpr);
    const label: number = Math.ceil(ctx.measureText(peer.name).width) + 2 * pad;
    const labelH: number = Math.round((style.labelCssPx + 4) * scene.scale.dpr);
    ctx.fillRect(at.x, at.y - labelH, label, labelH);
    ctx.fillStyle = style.labelText;
    ctx.fillText(peer.name, at.x + pad, at.y);
  }
}

export function paintCaretLayer(ctx: Ctx2D, width: number, height: number, scene: OverlayScene, style: OverlayStyle): void {
  ctx.clearRect(0, 0, width, height);
  if (scene.caret !== null && scene.caret.page === scene.page) {
    ctx.fillStyle = style.caret;
    caretAt(ctx, scene.caret, scene.scale, style.caretCssPx);
  }
}
