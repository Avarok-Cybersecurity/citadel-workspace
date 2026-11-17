/**
 * A `GLYPH_RUN` payload (`docs/display-list.md` v5 § Placing a GLYPH_RUN): the run head names a
 * strike, and every glyph is its prediction (its cluster one character after the previous
 * glyph's, its glyph from the face's char table, its advance the strike's base or one more, no
 * offsets) except where a sparse column lists it. Decoded whole into the arrays painters read,
 * every invariant the spec lists for a run checked on the way.
 */
import { RUN_ADVANCES, RUN_CLUSTERS, RUN_COLUMNS, RUN_IDS, RUN_PLUS_ONE, RUN_X_OFFSETS, RUN_Y_OFFSETS } from '../format';
import { ByteReader, DisplayListError, unzigzag, type Utf8String } from './byte-reader';
import type { CharTable, DisplayList, Op, Strike } from './types';

type GlyphRun = Extract<Op, { kind: 'glyphRun' }>;

/**
 * Glyphs a run may hold per byte of its text, plus one run's worth for empty text. A predicted
 * glyph costs no bytes, so the payload cannot bound the count; shaping gives at most a few
 * glyphs per character (a decomposed accent, a split vowel), never this many per UTF-8 byte.
 * Past it a run is refused before anything is sized by it (CWE-789).
 */
const MAX_GLYPHS_PER_TEXT_BYTE: number = 8;
const MAX_GLYPHS_EMPTY_TEXT: number = 8;

/** A sparse column: (`uv` gap, `uv` value) entries for glyphs `previous + 1 + gap`, in order. */
class Sparse {
  /** The glyph the pending entry is for; -1 once there is none. */
  at: number = -1;
  value: number = 0;

  constructor(private readonly r: ByteReader | null, private readonly glyphs: number) {
    this.next(0);
  }

  private next(from: number): void {
    if (this.r === null || this.r.done) {
      this.at = -1;
      return;
    }
    this.at = from + this.r.uv();
    this.value = this.r.uv() >>> 0;
    if (this.at >= this.glyphs) throw new DisplayListError('a column lists a glyph past the run\'s last');
  }

  /** Glyph `i`'s entry, if this column lists it. */
  take(i: number): number | null {
    if (this.at !== i) return null;
    const v: number = this.value;
    this.next(i + 1);
    return v;
  }
}

function column(r: ByteReader, flags: number, flag: number, glyphs: number): Sparse {
  return new Sparse((flags & flag) === 0 ? null : r.take(r.uv()), glyphs);
}

/** The code point starting at byte `at` and its UTF-8 length; null at the end. Text is valid UTF-8. */
function charAt(bytes: Uint8Array, at: number): { readonly cp: number; readonly width: number } | null {
  if (at >= bytes.length) return null;
  const b: number = bytes[at];
  if (b < 0x80) return { cp: b, width: 1 };
  const width: number = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2;
  let cp: number = b & (0xff >> (width + 1));
  for (let k: number = 1; k < width; k++) cp = (cp << 6) | (bytes[at + k] & 0x3f);
  return { cp, width };
}

function predicted(chars: CharTable, cp: number): number {
  const index: number | undefined = cp < 0x80 ? chars.ascii[cp] : chars.other.get(cp);
  return index === undefined || index < 0 ? 0 : index;
}

const isBoundary = (bytes: Uint8Array, at: number): boolean => at === bytes.length || (at < bytes.length && (bytes[at] & 0xc0) !== 0x80);

export function glyphRun(r: ByteReader, list: DisplayList): GlyphRun {
  const strikeId: number = r.uv();
  const strike: Strike | undefined = list.strikes[strikeId];
  if (strike === undefined) throw new DisplayListError(`strike ${strikeId} is not in the strike table`);
  const color: number = r.rgba();
  const x: number = r.zz();
  const y: number = r.zz();
  const text: Utf8String = r.utf8();
  const n: number = r.uv();
  if (n > MAX_GLYPHS_PER_TEXT_BYTE * text.bytes.length + MAX_GLYPHS_EMPTY_TEXT) throw new DisplayListError(`a run of ${text.bytes.length} text bytes claims ${n} glyphs`);
  const flags: number = r.u8();
  if ((flags & ~RUN_COLUMNS) !== 0) throw new DisplayListError('unknown glyph-run column flags');
  const ids: Sparse = column(r, flags, RUN_IDS, n);
  const clusterColumn: Sparse = column(r, flags, RUN_CLUSTERS, n);
  const bitmap: Uint8Array | null = (flags & RUN_PLUS_ONE) === 0 ? null : r.bytes(Math.ceil(n / 8));
  const advanceColumn: Sparse = column(r, flags, RUN_ADVANCES, n);
  const xs: Sparse = column(r, flags, RUN_X_OFFSETS, n);
  const ys: Sparse = column(r, flags, RUN_Y_OFFSETS, n);
  if (n > 0 && strike.ids.length === 0) throw new DisplayListError('a run in a face with no glyphs has glyphs');
  if (bitmap !== null && n % 8 !== 0 && bitmap[bitmap.length - 1] >> (n % 8) !== 0) throw new DisplayListError("the advance bitmap's padding bits are set");
  const chars: CharTable = list.faces[strike.faceId].chars;

  const glyphIds: Uint16Array = new Uint16Array(n);
  const clusters: Uint32Array = new Uint32Array(n);
  const advances: Int32Array = new Int32Array(n);
  const dx: Int32Array = new Int32Array(n);
  const dy: Int32Array = new Int32Array(n);
  let next: number = 0;
  for (let i: number = 0; i < n; i++) {
    let cluster: number = next;
    const delta: number | null = clusterColumn.take(i);
    if (delta !== null) {
      cluster += unzigzag(delta);
      if ((i > 0 && cluster < clusters[i - 1]) || cluster < 0 || !isBoundary(text.bytes, cluster)) {
        throw new DisplayListError(`glyph ${i}'s cluster ${cluster} decreases or is not a character boundary of the run's text`);
      }
    }
    const ch: { readonly cp: number; readonly width: number } | null = charAt(text.bytes, cluster);
    const listed: number | null = ids.take(i);
    if (listed !== null && listed >= strike.ids.length) throw new DisplayListError(`glyph index ${listed} is past the glyph table`);
    const index: number = listed ?? (ch === null ? 0 : predicted(chars, ch.cp));
    const base: number = strike.bases[index];
    const advance: number | null = advanceColumn.take(i);
    glyphIds[i] = strike.ids[index];
    clusters[i] = cluster;
    advances[i] = advance !== null ? (base + unzigzag(advance)) | 0 : (base + (bitmap === null ? 0 : (bitmap[i >> 3] >> (i & 7)) & 1)) | 0;
    dx[i] = unzigzag(xs.take(i) ?? 0);
    dy[i] = unzigzag(ys.take(i) ?? 0);
    next = cluster + (ch === null ? 0 : ch.width);
  }
  return { kind: 'glyphRun', head: { faceId: strike.faceId, size: strike.size, color, x, y }, text: text.text, clusters, glyphIds, advances, dx, dy };
}
