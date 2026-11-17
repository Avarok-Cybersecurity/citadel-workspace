/**
 * Glyph outlines turned into Path2D once per (face, glyph): font units, y up, exactly as the
 * glyph-path record holds them. Every size, phase and colour reuses the same path; the atlas
 * applies size / units_per_em and the y flip when it rasterises.
 */
import { VERB_CLOSE, VERB_CUBIC, VERB_LINE, VERB_MOVE, VERB_QUAD } from '../format';
import { DisplayListError } from '../display-list/byte-reader';
import { parseGlyphPath, type GlyphOutline } from '../glyph/glyph-record';
import type { CanvasPort } from './canvas-port';

export interface PreparedGlyph {
  readonly faceId: number;
  readonly glyphId: number;
  readonly outline: GlyphOutline;
  /** Null for a glyph with no outline (a space): nothing to draw. */
  readonly path: Path2D | null;
}

function buildPath(port: CanvasPort, o: GlyphOutline): Path2D | null {
  if (o.verbs.length === 0) return null;
  const p: Path2D = port.createPath();
  const c: Int16Array = o.coords;
  let at: number = 0;
  for (const verb of o.verbs) {
    switch (verb) {
      case VERB_MOVE: p.moveTo(c[at], c[at + 1]); at += 2; break;
      case VERB_LINE: p.lineTo(c[at], c[at + 1]); at += 2; break;
      case VERB_QUAD: p.quadraticCurveTo(c[at], c[at + 1], c[at + 2], c[at + 3]); at += 4; break;
      case VERB_CUBIC: p.bezierCurveTo(c[at], c[at + 1], c[at + 2], c[at + 3], c[at + 4], c[at + 5]); at += 6; break;
      case VERB_CLOSE: p.closePath(); break;
      default: throw new DisplayListError(`unknown glyph path verb ${verb}`);
    }
  }
  return p;
}

const keyOf = (faceId: number, glyphId: number): number => faceId * 0x10000 + glyphId;

export class OutlineStore {
  private readonly glyphs: Map<number, PreparedGlyph> = new Map<number, PreparedGlyph>();

  constructor(private readonly port: CanvasPort) {}

  has(faceId: number, glyphId: number): boolean {
    return this.glyphs.has(keyOf(faceId, glyphId));
  }

  /** Adds a batch of glyph-path records: `records` sliced by `offsets` (n + 1 entries). */
  add(faceId: number, glyphIds: Uint16Array, records: Uint8Array, offsets: Uint32Array): void {
    if (offsets.length !== glyphIds.length + 1) throw new DisplayListError('glyph path batch offsets do not match its glyphs');
    glyphIds.forEach((glyphId: number, i: number) => {
      const outline: GlyphOutline = parseGlyphPath(records.subarray(offsets[i], offsets[i + 1]));
      this.glyphs.set(keyOf(faceId, glyphId), { faceId, glyphId, outline, path: buildPath(this.port, outline) });
    });
  }

  get(faceId: number, glyphId: number): PreparedGlyph {
    const glyph: PreparedGlyph | undefined = this.glyphs.get(keyOf(faceId, glyphId));
    if (glyph === undefined) throw new DisplayListError(`glyph ${glyphId} of face ${faceId} was painted before its outline arrived`);
    return glyph;
  }

  get size(): number {
    return this.glyphs.size;
  }
}
