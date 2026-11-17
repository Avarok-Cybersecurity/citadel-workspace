/**
 * Paints one decoded page into a 2d context in device pixels, op by op in painting order
 * (`docs/display-list.md` v2 § Operations), with the rounding rule of units.ts. The context's
 * transform is the identity throughout; only glyph fills set (and restore) their own.
 *
 * Links paint nothing: they come back as hit areas in CSS px, for the page view to overlay.
 * Selection and caret are not painted here; they belong to overlay canvases above the page.
 */
import { SEG_CLOSE, SEG_CUBIC, SEG_LINE, SEG_MOVE } from '../format';
import { placeGlyphRun } from '../display-list/text-placement';
import type { Face, Op, PageOps, PathData, Rect } from '../display-list/types';
import type { Ctx2D } from './canvas-port';
import { cssColor } from './color';
import type { GlyphAtlas } from './glyph-atlas';
import type { PaintableImage } from './image-cache';
import type { OutlineStore } from './glyph-outlines';
import { crisp, px, quarterPx, rectPx, strokePx, type DeviceScale, type PixelRect } from './units';

export interface LinkArea {
  /** CSS px within the page. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly target: string;
}

export interface PagePaintEnv {
  readonly ctx: Ctx2D;
  readonly scale: DeviceScale;
  readonly faces: readonly Face[];
  readonly atlas: GlyphAtlas;
  readonly outlines: OutlineStore;
  /** The sheet's colour, painted under every op. */
  readonly paper: string;
  /** The image an op names, decoded or a placeholder; undefined until it has been resolved. */
  readonly images: (contentId: string) => PaintableImage | undefined;
  readonly placeholder: ImagePlaceholderStyle;
}

/** The box drawn for an image the canvas does not draw: a border and a label, in CSS px. */
export interface ImagePlaceholderStyle {
  readonly stroke: string;
  readonly labelColor: string;
  readonly labelCssPx: number;
  readonly labelFamily: string;
}

function placeholder(env: PagePaintEnv, r: PixelRect, label: string | null): void {
  const { ctx } = env;
  ctx.lineWidth = 1;
  ctx.strokeStyle = env.placeholder.stroke;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  if (label === null) return;
  const size: number = Math.round(env.placeholder.labelCssPx * env.scale.dpr);
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.font = `${size}px ${env.placeholder.labelFamily}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = env.placeholder.labelColor;
  ctx.fillText(label, r.x + size / 2, r.y + size / 2);
  ctx.restore();
}

/** `cdoc_paint::allowed_link`: http, https and mailto only, case-insensitive, leading space ignored. */
export function allowedLink(target: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(target.trimStart());
}

function tracePath(ctx: Ctx2D, path: PathData, k: number): void {
  const c: Int32Array = path.coords;
  let at: number = 0;
  ctx.beginPath();
  for (const verb of path.verbs) {
    if (verb === SEG_MOVE) { ctx.moveTo(c[at] * k, c[at + 1] * k); at += 2; }
    else if (verb === SEG_LINE) { ctx.lineTo(c[at] * k, c[at + 1] * k); at += 2; }
    else if (verb === SEG_CUBIC) { ctx.bezierCurveTo(c[at] * k, c[at + 1] * k, c[at + 2] * k, c[at + 3] * k, c[at + 4] * k, c[at + 5] * k); at += 6; }
    else if (verb === SEG_CLOSE) ctx.closePath();
  }
}

function line(ctx: Ctx2D, op: Extract<Op, { kind: 'line' }>, k: number): void {
  const w: number = strokePx(op.width, k);
  const c: number = crisp(w);
  ctx.lineWidth = w;
  ctx.lineCap = 'butt';
  ctx.strokeStyle = cssColor(op.color);
  ctx.beginPath();
  if (op.y1 === op.y2) {
    ctx.moveTo(px(op.x1, k), px(op.y1, k) + c);
    ctx.lineTo(px(op.x2, k), px(op.y2, k) + c);
  } else if (op.x1 === op.x2) {
    ctx.moveTo(px(op.x1, k) + c, px(op.y1, k));
    ctx.lineTo(px(op.x2, k) + c, px(op.y2, k));
  } else {
    ctx.moveTo(op.x1 * k, op.y1 * k);
    ctx.lineTo(op.x2 * k, op.y2 * k);
  }
  ctx.stroke();
}

function text(env: PagePaintEnv, op: Extract<Op, { kind: 'glyphRun' }>): void {
  const { k } = env.scale;
  const face: Face = env.faces[op.head.faceId];
  const sizePx: number = quarterPx(op.head.size * k);
  const color: string = cssColor(op.head.color);
  const y: number = px(op.head.y, k);
  const visit = (glyphId: number, gx: number, gy: number): void => {
    env.atlas.draw(env.ctx, {
      glyph: env.outlines.get(face.faceId, glyphId), unitsPerEm: face.unitsPerEm, sizePx,
      x: quarterPx(gx * k), y: gy === op.head.y ? y : px(gy, k), color,
    });
  };
  placeGlyphRun(op, visit);
}

function cssRect(r: Rect, css: number): Omit<LinkArea, 'target'> {
  return { x: r.x * css, y: r.y * css, w: r.w * css, h: r.h * css };
}

/** Paints `page` over a fresh sheet; returns the honoured links' hit areas. */
export function paintPage(env: PagePaintEnv, page: PageOps): LinkArea[] {
  const { ctx } = env;
  const { k, css } = env.scale;
  const links: LinkArea[] = [];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = env.paper;
  ctx.fillRect(0, 0, px(page.entry.width, k), px(page.entry.height, k));
  for (const op of page.ops) {
    switch (op.kind) {
      case 'fillRect': {
        const r: PixelRect = rectPx(op.rect, k);
        ctx.fillStyle = cssColor(op.color);
        ctx.fillRect(r.x, r.y, r.w, r.h);
        break;
      }
      case 'strokeRect': {
        const r: PixelRect = rectPx(op.rect, k);
        const w: number = strokePx(op.width, k);
        ctx.lineWidth = w;
        ctx.lineJoin = 'miter';
        ctx.strokeStyle = cssColor(op.color);
        ctx.strokeRect(r.x + crisp(w), r.y + crisp(w), r.w, r.h);
        break;
      }
      case 'line': line(ctx, op, k); break;
      case 'fillPath':
        tracePath(ctx, op.path, k);
        ctx.fillStyle = cssColor(op.color);
        ctx.fill('nonzero');
        break;
      case 'strokePath':
        tracePath(ctx, op.path, k);
        ctx.lineWidth = strokePx(op.width, k);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = cssColor(op.color);
        ctx.stroke();
        break;
      case 'glyphRun': text(env, op); break;
      case 'image': {
        // The same rounding as every rect, so the picture lands where PDF and SVG put it.
        const r: PixelRect = rectPx(op.rect, k);
        const image: PaintableImage | undefined = env.images(op.contentId);
        if (image?.kind === 'drawn') ctx.drawImage(image.image.source, r.x, r.y, r.w, r.h);
        else placeholder(env, r, image?.label ?? null);
        break;
      }
      case 'link':
        if (allowedLink(op.target)) links.push({ ...cssRect(op.rect, css), target: op.target });
        break;
      // An unsigned signature field is the PDF's form field; the page shows nothing for it.
      case 'sigField': break;
      case 'clipPush': {
        const r: PixelRect = rectPx(op.rect, k);
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
        break;
      }
      case 'clipPop': ctx.restore(); break;
      // Where the page's text came from, for an editor; nothing to draw.
      case 'caretLines': break;
    }
  }
  return links;
}
