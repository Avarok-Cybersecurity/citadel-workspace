/**
 * What Insert › Picture accepts: the types every output (page, PDF, DOCX) can draw. The size cap
 * is the engine's own (engine-limits.ts MAX_IMAGE_BYTES), and sizing is the editor's
 * (InsertImageFitted fits a picture to the column, never up).
 */

/** The picture types every output (page, PDF, DOCX) can draw. */
export const PICTURE_TYPES: readonly string[] = ['image/png', 'image/jpeg'];
