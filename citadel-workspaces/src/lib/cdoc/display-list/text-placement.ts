/**
 * Where each glyph of a run stands, in Pt100 page space (`docs/display-list.md` v5 § Placing a
 * GLYPH_RUN). Visitor-shaped so painting a run allocates nothing.
 */
import type { Op } from './types';

export type GlyphVisitor = (glyphId: number, x: number, y: number) => void;

type GlyphRun = Extract<Op, { kind: 'glyphRun' }>;

export function placeGlyphRun(run: GlyphRun, visit: GlyphVisitor): void {
  let pen: number = run.head.x;
  for (let i: number = 0; i < run.glyphIds.length; i++) {
    visit(run.glyphIds[i], pen + run.dx[i], run.head.y + run.dy[i]);
    pen += run.advances[i];
  }
}
