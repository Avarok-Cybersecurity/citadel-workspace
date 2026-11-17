/**
 * Where the Citadel Docs binaries, faces and hyphenation patterns are served. Stable, unhashed
 * URLs: the editor binary is precached with its glue (vite.config.ts); the PDF binary is fetched
 * on the first PDF export and the patterns as a document needs them. scripts/sync-cdoc-wasm.sh
 * writes each binary's URL into its glue, which the vendored-pair test checks against these.
 */
export const CDOC_EDITOR_WASM_URL: string = '/cdoc/cdoc_wasm_editor_bg.wasm';
export const CDOC_PDF_WASM_URL: string = '/cdoc/cdoc_wasm_pdf_bg.wasm';
export const CDOC_FONT_BASE_URL: string = '/fonts/cdoc/';
export const CDOC_PATTERN_BASE_URL: string = '/cdoc/patterns/';
