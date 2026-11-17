/**
 * Every limit and option the browser hands cdoc-wasm, in one place (PCND: the engine takes
 * them as required arguments, so no size is ever an implicit default). Each value is sized
 * for a browser tab, with its reason beside it.
 */

/**
 * The largest image a file may embed and still open (`fromDocument`'s maxImageBytes), and the
 * largest a user may add: 32 MiB, half the 64 MiB the engine allows for one part of a
 * package, so one picture cannot take a document's whole budget.
 */
export const MAX_IMAGE_BYTES: number = 32 * 1024 * 1024;

/**
 * Markdown import, Pt100 (cdoc_md::MdReadOptions; every field required): the blank document's
 * text width, A4 (59530) less two 1-inch margins (7200 each), and for an image with no size
 * that width at 4:3.
 */
export const MD_READ_OPTIONS: { readonly textWidth: number; readonly imageWidth: number; readonly imageHeight: number } = {
  textWidth: 45130,
  imageWidth: 45130,
  imageHeight: 33848,
};

/**
 * applyRemote's buffer for operations waiting on a dependency (docs/edit-commands.md): 10 000
 * operations and 8 MiB hold any honest gap many times over. What is over is dropped, never
 * lost: it is not in the state vector, so the next diff sends it again.
 */
export interface PendingLimits {
  readonly maxOps: number;
  readonly maxBytes: number;
}
export const PENDING_LIMITS: PendingLimits = { maxOps: 10_000, maxBytes: 8 * 1024 * 1024 };

/**
 * DOCX and ODT reads (cdoc_pkg::ReadLimits; every field required): what a package may inflate
 * and parse in a tab. The read holds the file, its inflated parts and the document at once, so
 * the 128 MiB total is what keeps a tab alive; one part at 64 MiB, compression past 100 KiB at
 * most 100:1, elements nested 256 deep, 5000 parts.
 */
export const READ_LIMITS: {
  readonly maxParts: number;
  readonly maxPartBytes: number;
  readonly maxTotalBytes: number;
  readonly maxRatio: number;
  readonly ratioGraceBytes: number;
  readonly maxDepth: number;
} = {
  maxParts: 5000,
  maxPartBytes: 64 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxRatio: 100,
  ratioGraceBytes: 100 * 1024,
  maxDepth: 256,
};

/** The options a DOCX or ODT read takes (docx_to_pm, odt_to_pm, EditorHandle.fromDocument). */
export const PACKAGE_READ_OPTIONS: { readonly limits: typeof READ_LIMITS } = { limits: READ_LIMITS };

/** The deepest list level, inclusive: a list has nine, 0..=8 (cdoc_model::numbering::MAX_LEVEL). */
export const MAX_LIST_LEVEL: number = 8;

/** Plain-text import: a single newline is a line break, a blank line a new paragraph. */
export const TXT_READ_OPTIONS: { readonly singleNewline: 'break' | 'space' } = { singleNewline: 'break' };
