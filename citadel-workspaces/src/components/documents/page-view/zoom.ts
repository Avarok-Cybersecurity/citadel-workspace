/** Zoom: 50% to 400%, as a factor. Every change goes through clampZoom. */

export const MIN_ZOOM: number = 0.5;
export const MAX_ZOOM: number = 4;
/** What a document opens at: 100%, the size it prints. */
export const INITIAL_ZOOM: number = 1;
/** One keyboard or button step. */
export const ZOOM_STEP: number = 0.1;
/** Ctrl+wheel: zoom multiplies by e^(−deltaY × this), so a notch is ~10% either way. */
const WHEEL_SENSITIVITY: number = 0.001;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) throw new RangeError(`zoom must be finite, got ${zoom}`);
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) * 100) / 100;
}

export function zoomByWheel(zoom: number, deltaY: number): number {
  return clampZoom(zoom * Math.exp(-deltaY * WHEEL_SENSITIVITY));
}

export function zoomBySteps(zoom: number, steps: number): number {
  return clampZoom(zoom + steps * ZOOM_STEP);
}

export function zoomPercent(zoom: number): number {
  return Math.round(zoom * 100);
}
