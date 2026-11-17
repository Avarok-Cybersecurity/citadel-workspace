/**
 * The glyph-path and face-metrics records `cdoc-wasm` serves for a glyph atlas
 * (`docs/display-list.md` v1 § Glyph paths, § Face metrics). Font units, y up.
 */
import {
  FACE_METRICS_LEN, PATH_HEADER_LEN, PATH_VERSION, VERB_CLOSE, VERB_CUBIC, VERB_LINE, VERB_MOVE, VERB_QUAD,
} from '../format';
import { DisplayListError } from '../display-list/byte-reader';

export interface GlyphOutline {
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
  readonly verbs: Uint8Array;
  /** Every verb's coordinates in order (move/line 2, quad 4, cubic 6, close 0). */
  readonly coords: Int16Array;
}

export interface FaceMetrics {
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
}

const COORDS_PER_VERB: ReadonlyMap<number, number> = new Map<number, number>([
  [VERB_MOVE, 2], [VERB_LINE, 2], [VERB_QUAD, 4], [VERB_CUBIC, 6], [VERB_CLOSE, 0],
]);

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function parseGlyphPath(bytes: Uint8Array): GlyphOutline {
  const v: DataView = viewOf(bytes);
  if (v.byteLength < PATH_HEADER_LEN) throw new DisplayListError('glyph path record is truncated');
  if (v.getUint8(0) !== PATH_VERSION) throw new DisplayListError(`glyph path version ${v.getUint8(0)} is not supported`);
  const count: number = v.getUint16(2, true);
  const verbs: Uint8Array = new Uint8Array(count);
  const coords: number[] = [];
  let at: number = PATH_HEADER_LEN;
  for (let i: number = 0; i < count; i++) {
    if (at >= v.byteLength) throw new DisplayListError('glyph path record is truncated');
    const verb: number = v.getUint8(at++);
    const n: number | undefined = COORDS_PER_VERB.get(verb);
    if (n === undefined) throw new DisplayListError(`unknown glyph path verb ${verb}`);
    if (at + 2 * n > v.byteLength) throw new DisplayListError('glyph path record is truncated');
    verbs[i] = verb;
    for (let k: number = 0; k < n; k++, at += 2) coords.push(v.getInt16(at, true));
  }
  if (at !== v.byteLength) throw new DisplayListError('glyph path record is longer than its commands');
  return {
    xMin: v.getInt16(4, true), yMin: v.getInt16(6, true), xMax: v.getInt16(8, true), yMax: v.getInt16(10, true),
    verbs, coords: Int16Array.from(coords),
  };
}

export function parseFaceMetrics(bytes: Uint8Array): FaceMetrics {
  if (bytes.byteLength !== FACE_METRICS_LEN) throw new DisplayListError(`face metrics record is ${bytes.byteLength} bytes, not ${FACE_METRICS_LEN}`);
  const v: DataView = viewOf(bytes);
  return { unitsPerEm: v.getUint16(0, true), ascender: v.getInt16(2, true), descender: v.getInt16(4, true), lineGap: v.getInt16(6, true) };
}
