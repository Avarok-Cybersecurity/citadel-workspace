/**
 * The painter's settings, stated once for both renderers (main thread and worker).
 *
 * Atlas: four cell classes on 1024px surfaces, created on first use: 4096 cells of 16px (body
 * text up to ~11px glyph height), 1024 of 32px, 256 of 64px, 64 of 128px; larger glyphs are
 * filled from their path. At most 4 × 4 MB of surface, and only for the classes a document uses.
 *
 * Paper is the sheet's colour, the document's and not the theme's: a page is white in dark mode
 * as it is on paper, as in every word processor. The image placeholder is the box drawn for an
 * image the canvas does not draw (anything but PNG and JPEG, as PDF and SVG draw them): a grey
 * border and its MIME type. Decoded images are held up to 128 MiB of pixels (width × height ×
 * 4): a hundred 1080p photos, a tab's worth, before the least recently drawn are dropped.
 */
import type { RasterizerOptions } from './page-rasterizer';
import type { OverlayStyle } from './overlay-painter';

export const RASTERIZER_OPTIONS: RasterizerOptions = {
  atlas: { cellSizes: [16, 32, 64, 128], surfaceSide: 1024 },
  paper: '#ffffff',
  placeholder: { stroke: '#c8c8c8', labelColor: '#6b6b6b', labelCssPx: 11, labelFamily: 'system-ui, sans-serif' },
  imageCacheBytes: 128 * 1024 * 1024,
};

/**
 * Page paints in flight at once, across every page of a view. One: the worker paints one page
 * at a time anyway, so a second in flight only queues there, where it can no longer be put
 * behind a page that has just come into view (PaintQueue orders them here).
 */
export const PAINT_CONCURRENCY: number = 1;

/**
 * Pages kept painted either side of the view once painted, and painted ahead when idle. Two: a
 * page bitmap is 3.6 MB at 1x and 14 MB at 2x for A4, so the window holds about 100 MB at 2x
 * on top of the pages in view; scrolling back within it never repaints.
 */
export const PAINT_AHEAD_PAGES: number = 2;

/** Canvases mounted per idle tick when painting ahead: each is a transfer and a paint, so one. */
export const PAINT_AHEAD_MOUNTS_PER_TICK: number = 1;

/** How long a face or pattern fetch may take before the open fails instead of hanging. */
export const ASSET_FETCH_TIMEOUT_MS: number = 30_000;

/**
 * The selection and caret overlays. Concrete colours, because a canvas cannot read CSS
 * variables, and the sheet is white in both themes: Word's selection blue at 30%, a black caret.
 */
export const OVERLAY_STYLE: OverlayStyle = {
  selection: 'rgba(38, 132, 255, 0.3)',
  caret: '#000000',
  caretCssPx: 1,
  peerSelectionAlpha: 0.25,
  labelCssPx: 11,
  labelFamily: 'system-ui, sans-serif',
  labelText: '#ffffff',
};
