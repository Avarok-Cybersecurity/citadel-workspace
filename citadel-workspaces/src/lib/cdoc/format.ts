/**
 * The display-list format's constants, version 5: the one place the numbers live on this side.
 *
 * Mirrors citadel-docs `docs/display-list.md` (format version 5) and its Rust twin
 * `crates/cdoc-paint/src/format.rs` and `glyph.rs`. A reader refuses any version it was not
 * written for, so bumping VERSION here without rewriting the decoder is a bug.
 */

export const MAGIC: readonly number[] = [0x43, 0x44, 0x50, 0x4c]; // "CDPL"
export const VERSION: number = 5;
export const HEADER_LEN: number = 24;
export const INDEX_ENTRY_LEN: number = 20;

export const STYLE_BOLD: number = 1;
export const STYLE_ITALIC: number = 2;

export const OP_FILL_RECT: number = 0x01;
export const OP_STROKE_RECT: number = 0x02;
export const OP_LINE: number = 0x03;
export const OP_FILL_PATH: number = 0x04;
export const OP_STROKE_PATH: number = 0x05;
export const OP_GLYPH_RUN: number = 0x11;
export const OP_IMAGE: number = 0x20;
export const OP_LINK: number = 0x21;
export const OP_SIG_FIELD: number = 0x22;
export const OP_CLIP_PUSH: number = 0x30;
export const OP_CLIP_POP: number = 0x31;
export const OP_CARET_LINES: number = 0x40;

/** A GLYPH_RUN's column flags (§ The glyphs: predictions and columns), in payload order. */
export const RUN_IDS: number = 0x01;
export const RUN_CLUSTERS: number = 0x02;
export const RUN_PLUS_ONE: number = 0x04;
export const RUN_ADVANCES: number = 0x08;
export const RUN_X_OFFSETS: number = 0x10;
export const RUN_Y_OFFSETS: number = 0x20;
export const RUN_COLUMNS: number = 0x3f;

/** A CARET_LINES line head's flags. */
export const LINE_NEW: number = 0x01;
export const LINE_SAME_PITCH: number = 0x02;
export const LINE_SAME_HEIGHT: number = 0x04;
export const LINE_NO_STOPS: number = 0x08;

/** Display-list path verbs (FILL_PATH / STROKE_PATH segments). */
export const SEG_MOVE: number = 0;
export const SEG_LINE: number = 1;
export const SEG_CUBIC: number = 2;
export const SEG_CLOSE: number = 3;

/** Glyph-path record (§ Glyph paths): font units, y up. */
export const PATH_VERSION: number = 1;
export const PATH_HEADER_LEN: number = 12;
export const VERB_MOVE: number = 0;
export const VERB_LINE: number = 1;
export const VERB_QUAD: number = 2;
export const VERB_CUBIC: number = 3;
export const VERB_CLOSE: number = 4;

/** Face-metrics record (§ Face metrics). */
export const FACE_METRICS_LEN: number = 8;

/** Hundredths of a PostScript point per inch: the format's unit is Pt100. */
export const PT100_PER_INCH: number = 7200;
