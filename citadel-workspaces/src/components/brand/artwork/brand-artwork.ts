/**
 * One lockup from the brand kit, as the kit draws it: its box, the C's arc, the arrow and (for
 * the lockups that spell the name) the name as outlined glyphs, never live text. The values are
 * generated from assets/brand/svg by the parent repository's scripts/sync-brand-kit.mjs.
 *
 * Colour is not part of it. The kit's plain and -ondark files are the same drawing in two
 * colourings, and which one applies depends on the ground the page puts it on, so the page
 * supplies the colours (styles/brand-tokens.css) and the drawing stays the kit's.
 */
export interface BrandArtwork {
  readonly viewBox: string;
  /** The viewBox's width and height, in the artwork's own units. */
  readonly width: number;
  readonly height: number;
  readonly strokeWidth: number;
  /** One x, the arrowhead's height, in the artwork's units: nothing may enter it. */
  readonly clearSpace: number;
  readonly arc: string;
  readonly arrow: string;
  readonly glyphs: string | null;
}
