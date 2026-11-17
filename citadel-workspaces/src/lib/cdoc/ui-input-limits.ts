/**
 * Bounds the editor's input fields hold a value to before sending it. These are UI choices, not
 * engine limits (those are in engine/engine-limits.ts); the engine accepts values past them.
 */

/** The largest paragraph spacing or indent, either sign, in points: Word's own field maximum. */
export const PARAGRAPH_MEASURE_MAX_PT: number = 1584;
