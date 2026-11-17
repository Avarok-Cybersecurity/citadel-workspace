/**
 * Opens a display list (`docs/display-list.md` v5): header, face table with per-face glyph and
 * char tables and the strike table, string table, document table and page index, checked once. Page bodies are decoded one at a time by
 * offset (`decodePage` in page-ops.ts), so a buffer that ends after page N's body opens and
 * serves pages 0..=N. Reads in place over the caller's ArrayBuffer; nothing is copied.
 */
import { HEADER_LEN, INDEX_ENTRY_LEN, MAGIC, STYLE_BOLD, STYLE_ITALIC, VERSION } from '../format';
import { ByteReader, DisplayListError } from './byte-reader';
import { stringAt } from './page-ops';
import type { CharTable, DisplayList, DocumentTable, Face, GlyphMetric, OutlineHeading, PageEntry, Strike } from './types';

const MAX_U16: number = 0xffff;

function viewOf(bytes: ArrayBuffer | Uint8Array): DataView {
  // isView, not instanceof: bytes from a worker, WASM or another realm fail instanceof.
  return ArrayBuffer.isView(bytes)
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new DataView(bytes);
}

function readFace(r: ByteReader, faceId: number): Face {
  const style: number = r.u8();
  if ((style & ~(STYLE_BOLD | STYLE_ITALIC)) !== 0) throw new DisplayListError(`face ${faceId} sets reserved style bits`);
  const family: string = r.str();
  const unitsPerEm: number = r.uv();
  if (unitsPerEm === 0 || unitsPerEm > MAX_U16) throw new DisplayListError(`face ${faceId} has units_per_em ${unitsPerEm}`);
  // A glyph metric is two varints: glyph id and advance.
  const count: number = r.count(2, `face ${faceId}'s glyph table`);
  const glyphs: GlyphMetric[] = new Array<GlyphMetric>(count);
  for (let i: number = 0; i < count; i++) {
    const glyphId: number = r.uv();
    const advance: number = r.uv();
    if (glyphId > MAX_U16 || advance > MAX_U16) throw new DisplayListError(`face ${faceId} glyph ${i} exceeds 16 bits`);
    glyphs[i] = { glyphId, advance };
  }
  const chars: CharTable = readChars(r, faceId, count);
  return { faceId, family, bold: (style & STYLE_BOLD) !== 0, italic: (style & STYLE_ITALIC) !== 0, unitsPerEm, glyphs, chars };
}

const MAX_CODE_POINT: number = 0x10ffff;
const isScalar = (cp: number): boolean => cp <= MAX_CODE_POINT && (cp < 0xd800 || cp > 0xdfff);

/** `(gap, glyph index)` pairs in increasing code-point order: each code point the previous plus one plus `gap`. */
function readChars(r: ByteReader, faceId: number, glyphs: number): CharTable {
  const ascii: Int32Array = new Int32Array(0x80).fill(-1);
  const other: Map<number, number> = new Map<number, number>();
  const count: number = r.count(2, `face ${faceId}'s char table`);
  let next: number = 0;
  for (let i: number = 0; i < count; i++) {
    const cp: number = next + r.uv();
    const index: number = r.uv();
    if (!isScalar(cp)) throw new DisplayListError(`face ${faceId}'s char table entry ${i} is not a character`);
    if (index >= glyphs) throw new DisplayListError(`face ${faceId}'s char table index ${index} is past the glyph table`);
    if (cp < 0x80) ascii[cp] = index; else other.set(cp, index);
    next = cp + 1;
  }
  return { ascii, other };
}

/** Per strike: face id, size, then a base advance for each glyph of that face's glyph table. */
function readStrikes(r: ByteReader, faces: readonly Face[]): Strike[] {
  const count: number = r.count(2, 'the strike table');
  const strikes: Strike[] = [];
  for (let s: number = 0; s < count; s++) {
    const faceId: number = r.uv();
    const face: Face | undefined = faces[faceId];
    if (face === undefined) throw new DisplayListError(`strike ${s}'s face ${faceId} is not in the face table`);
    const size: number = r.zz();
    const ids: Uint16Array = Uint16Array.from(face.glyphs, (g: GlyphMetric): number => g.glyphId);
    const bases: Int32Array = new Int32Array(face.glyphs.length);
    for (let g: number = 0; g < bases.length; g++) bases[g] = r.zz();
    strikes.push({ faceId, size, ids, bases });
  }
  return strikes;
}

/** `0` none, else a string index + 1. */
function optionalString(r: ByteReader, strings: readonly string[]): string | null {
  const n: number = r.uv();
  return n === 0 ? null : stringAt(strings, n - 1);
}

/** The document table, from where the last string ends to exactly the page index. */
function readDocument(r: ByteReader, strings: readonly string[]): DocumentTable {
  const title: string | null = optionalString(r, strings);
  const language: string | null = optionalString(r, strings);
  // A heading is at least four bytes: level, page, y and title index.
  const count: number = r.count(4, 'the outline');
  const outline: OutlineHeading[] = [];
  for (let i: number = 0; i < count; i++) {
    const level: number = r.u8();
    const page: number = r.uv();
    const y: number = r.zz();
    outline.push({ level, page, y, title: stringAt(strings, r.uv()) });
  }
  if (!r.done) throw new DisplayListError('document table does not end where the page index begins');
  return { title, language, outline };
}

export function openDisplayList(bytes: ArrayBuffer | Uint8Array): DisplayList {
  const view: DataView = viewOf(bytes);
  if (view.byteLength < HEADER_LEN) throw new DisplayListError(`truncated at byte ${view.byteLength}`);
  const head: ByteReader = new ByteReader(view, 0, HEADER_LEN);
  for (const expected of MAGIC) {
    if (head.u8() !== expected) throw new DisplayListError('not a display list (bad magic)');
  }
  const version: number = head.u16();
  if (version !== VERSION) {
    throw new DisplayListError(`version ${version} is not supported (this decoder reads ${VERSION})`);
  }
  if (head.u16() !== 0) throw new DisplayListError('reserved header flags are set');
  const pageCount: number = head.u32();
  const facesAt: number = head.u32();
  const stringsAt: number = head.u32();
  const indexAt: number = head.u32();
  if (facesAt !== HEADER_LEN || stringsAt < facesAt || indexAt < stringsAt) {
    throw new DisplayListError('sections out of order');
  }
  const indexEnd: number = indexAt + INDEX_ENTRY_LEN * pageCount;
  if (indexEnd > view.byteLength) throw new DisplayListError(`truncated at byte ${view.byteLength}`);

  const fr: ByteReader = new ByteReader(view, facesAt, stringsAt);
  const faceCount: number = fr.count(1, 'the face table');
  const faces: Face[] = [];
  for (let id: number = 0; id < faceCount; id++) faces.push(readFace(fr, id));
  const strikes: Strike[] = readStrikes(fr, faces);
  if (!fr.done) throw new DisplayListError('face table does not end where the string table begins');

  const sr: ByteReader = new ByteReader(view, stringsAt, indexAt);
  const stringCount: number = sr.count(1, 'the string table');
  const strings: string[] = [];
  for (let i: number = 0; i < stringCount; i++) strings.push(sr.str());
  const document: DocumentTable = readDocument(new ByteReader(view, sr.pos, indexAt), strings);

  const ir: ByteReader = new ByteReader(view, indexAt, indexEnd);
  const pages: PageEntry[] = [];
  for (let slot: number = 0; slot < pageCount; slot++) {
    const entry: PageEntry = { number: ir.u32(), offset: ir.u32(), length: ir.u32(), width: ir.i32(), height: ir.i32() };
    if (entry.offset < indexEnd) throw new DisplayListError(`page slot ${slot} overlaps the tables`);
    pages.push(entry);
  }
  return { view, faces, strikes, strings, document, pages, indexEnd };
}

/** The slot holding layout page `pageNumber`, or null when this (partial) list lacks it. */
export function slotOfPage(list: DisplayList, pageNumber: number): number | null {
  const slot: number = list.pages.findIndex((p: PageEntry): boolean => p.number === pageNumber);
  return slot < 0 ? null : slot;
}
