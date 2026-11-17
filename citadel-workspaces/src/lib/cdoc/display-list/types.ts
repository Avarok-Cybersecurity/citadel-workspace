/**
 * A decoded display list (`docs/display-list.md` v5). Every coordinate, length and size is
 * Pt100 (hundredths of a point), page space, y down. Colours are packed `0xRRGGBBAA`, straight
 * alpha.
 */

export type Rgba = number;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One entry of a face's glyph table: a glyph the list's runs draw, to preload before the bodies. */
export interface GlyphMetric {
  readonly glyphId: number;
  /** The face's `hmtx` advance, font units. */
  readonly advance: number;
}

/** A face by what it is, not by its index in one display list's face table. */
export interface FaceKey {
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

/**
 * Which glyph a character is predicted to be (§ Face table, the char table): an index into the
 * face's glyph table. A direct table for ASCII (-1: none), a map for the rest.
 */
export interface CharTable {
  readonly ascii: Int32Array;
  readonly other: ReadonlyMap<number, number>;
}

export interface Face {
  readonly faceId: number;
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly unitsPerEm: number;
  readonly glyphs: readonly GlyphMetric[];
  readonly chars: CharTable;
}

/** One face at one size (§ Strike table): per glyph-table index, its glyph id and base advance (Pt100). */
export interface Strike {
  readonly faceId: number;
  readonly size: number;
  readonly ids: Uint16Array;
  readonly bases: Int32Array;
}

export interface PageEntry {
  /** Zero-based page number in the layout. */
  readonly number: number;
  readonly offset: number;
  readonly length: number;
  readonly width: number;
  readonly height: number;
}

/** A heading of the document's outline (§ Document table). */
export interface OutlineHeading {
  /** 0 outermost. */
  readonly level: number;
  /** Its page number in the layout, which a partial list may not hold. */
  readonly page: number;
  /** Top of the heading's first line. */
  readonly y: number;
  readonly title: string;
}

/** The whole document's, in a partial list too. */
export interface DocumentTable {
  readonly title: string | null;
  /** BCP 47. */
  readonly language: string | null;
  readonly outline: readonly OutlineHeading[];
}

export interface DisplayList {
  readonly view: DataView;
  readonly faces: readonly Face[];
  /** By strike id, as runs name them. */
  readonly strikes: readonly Strike[];
  readonly strings: readonly string[];
  readonly document: DocumentTable;
  /** In slot order; a partial list holds only some page numbers. */
  readonly pages: readonly PageEntry[];
  /** First byte after the page index: every body starts at or after it. */
  readonly indexEnd: number;
}

/** A run's face and size, from the strike it names. */
export interface RunHead {
  readonly faceId: number;
  readonly size: number;
  readonly color: Rgba;
  readonly x: number;
  readonly y: number;
}

/** Path segments: one verb per segment and their points, flattened as x, y pairs. */
export interface PathData {
  readonly verbs: Uint8Array;
  readonly coords: Int32Array;
}

export type Op =
  | { readonly kind: 'fillRect'; readonly rect: Rect; readonly color: Rgba }
  | { readonly kind: 'strokeRect'; readonly rect: Rect; readonly width: number; readonly color: Rgba }
  | {
      readonly kind: 'line';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly width: number;
      readonly color: Rgba;
    }
  | { readonly kind: 'fillPath'; readonly color: Rgba; readonly path: PathData }
  | { readonly kind: 'strokePath'; readonly width: number; readonly color: Rgba; readonly path: PathData }
  /**
   * Shaped (every run is): the characters it stands for, then per glyph its id, its cluster (the
   * UTF-8 byte offset in `text` of its first character), advance, x offset and y offset.
   */
  | {
      readonly kind: 'glyphRun';
      readonly head: RunHead;
      readonly text: string;
      readonly clusters: Uint32Array;
      readonly glyphIds: Uint16Array;
      readonly advances: Int32Array;
      readonly dx: Int32Array;
      readonly dy: Int32Array;
    }
  | { readonly kind: 'image'; readonly rect: Rect; readonly contentId: string }
  | { readonly kind: 'link'; readonly rect: Rect; readonly target: string }
  /** An unsigned signature field: the PDF writes a form field; a page painter draws nothing. */
  | { readonly kind: 'sigField'; readonly rect: Rect; readonly fieldId: string; readonly role: string }
  | { readonly kind: 'clipPush'; readonly rect: Rect }
  | { readonly kind: 'clipPop' }
  /** A page's lines of document text, for an editor; checked, painted by nobody. */
  | { readonly kind: 'caretLines'; readonly lines: number };

export type OpKind = Op['kind'];

export interface PageOps {
  readonly entry: PageEntry;
  readonly ops: readonly Op[];
}
