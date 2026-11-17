/**
 * Pt100 → device pixels, with ONE rounding rule so page content is crisp at every zoom and DPR:
 *
 *   k = zoom × devicePixelRatio × 96 / 7200        device px per Pt100
 *   a coordinate maps to round(v × k)             (Math.round: halves round up)
 *   a rectangle rounds its two edges, never its size, so abutting rects still abut
 *   a stroke rounds its width to whole device px, at least 1, and an odd width sits on the
 *     half pixel, so a 1px rule covers one row instead of smearing over two
 *   glyph pens keep x in quarter device pixels (four atlas phases) and an integer baseline
 *   curves (paths, glyph outlines) are scaled, never rounded
 *
 * Zoom and DPR are always explicit: nothing here assumes 100% or a 1x screen.
 */
import { PT100_PER_INCH } from '../format';
import type { Rect } from '../display-list/types';

export const CSS_PX_PER_INCH: number = 96;

export interface DeviceScale {
  readonly zoom: number;
  readonly dpr: number;
  /** Device pixels per Pt100. */
  readonly k: number;
  /** CSS pixels per Pt100 (for layout and hit areas, which live in CSS space). */
  readonly css: number;
}

export function deviceScale(zoom: number, dpr: number): DeviceScale {
  if (!(zoom > 0) || !Number.isFinite(zoom)) throw new RangeError(`zoom must be a positive number, got ${zoom}`);
  if (!(dpr > 0) || !Number.isFinite(dpr)) throw new RangeError(`devicePixelRatio must be a positive number, got ${dpr}`);
  const css: number = (zoom * CSS_PX_PER_INCH) / PT100_PER_INCH;
  return { zoom, dpr, k: css * dpr, css };
}

export function px(v: number, k: number): number {
  return Math.round(v * k);
}

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function rectPx(r: Rect, k: number): PixelRect {
  const x: number = px(r.x, k);
  const y: number = px(r.y, k);
  return { x, y, w: px(r.x + r.w, k) - x, h: px(r.y + r.h, k) - y };
}

export function strokePx(width: number, k: number): number {
  return Math.max(1, Math.round(width * k));
}

/** The offset that centres a stroke of `widthPx` on pixel boundaries: 0.5 when odd. */
export function crisp(widthPx: number): number {
  return widthPx % 2 === 1 ? 0.5 : 0;
}

export function quarterPx(v: number): number {
  return Math.round(v * 4) / 4;
}

/**
 * A page's canvas size in device pixels: a whole number of CSS px, times the DPR. The browser
 * composites a canvas at its CSS size, so a fractional one (an odd device width at DPR 2 is
 * 793.5 CSS px) is drawn into the next whole CSS size, rescaling every glyph by a pixel's width
 * across the page: the blur this prevents. Content keeps the exact scale `k`; the sheet gains or
 * loses under one CSS px of paper at its right and bottom edges.
 */
export function pageSizePx(width: number, height: number, scale: DeviceScale): { readonly w: number; readonly h: number } {
  const css: { readonly w: number; readonly h: number } = pageSizeCss(width, height, scale);
  return { w: Math.round(css.w * scale.dpr), h: Math.round(css.h * scale.dpr) };
}

/** A page's size on screen: whole CSS px (at a fractional DPR its canvas is the nearest device size). */
export function pageSizeCss(width: number, height: number, scale: DeviceScale): { readonly w: number; readonly h: number } {
  return { w: Math.round(width * scale.css), h: Math.round(height * scale.css) };
}
