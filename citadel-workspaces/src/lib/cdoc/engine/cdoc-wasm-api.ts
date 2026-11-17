/**
 * The parts of the two cdoc-wasm artefacts the engine calls, typed from the generated
 * declarations: the editor artefact (layout, editing, and every format but PDF through
 * EditorHandle) and the PDF
 * artefact (layout and the PDF writer). The engine is handed initialised modules rather than
 * importing the glue, so loading them (fetch in the browser, file bytes under node) stays in
 * the adapters.
 */
import type * as Glue from '../../../../vendor/cdoc/cdoc_wasm_editor.js';
import type * as PdfGlue from '../../../../vendor/cdoc/cdoc_wasm_pdf.js';

export type CdocWasm = Pick<
  typeof Glue,
  | 'RenderAssets' | 'blank_pm_json' | 'model_to_pm' | 'pm_to_model' | 'pm_to_display_list' | 'glyph_path' | 'face_metrics' | 'version'
  | 'EditorFonts' | 'EditorHandle' | 'ImageStore' | 'hyphenation_patterns_needed'
>;

export type PdfWasm = Pick<typeof PdfGlue, 'RenderAssets' | 'model_to_pm' | 'pm_to_pdf'>;

export type RenderAssets = Glue.RenderAssets;
export type PdfRenderAssets = PdfGlue.RenderAssets;
export type EditorHandle = Glue.EditorHandle;
export type EditorSealedFonts = Glue.EditorSealedFonts;
export type ImportedEditor = Glue.ImportedEditor;
export type FileExport = Glue.FileExport;
export type ImageStore = Glue.ImageStore;

/** What faces and patterns are registered on: EditorFonts and either artefact's RenderAssets. */
export interface Furnishable {
  addFont(family: string, bold: boolean, italic: boolean, bytes: Uint8Array): void;
  aliasFont(name: string, target: string): void;
  addPatterns(tag: string, text: string): void;
}

/** What images are registered on: either artefact's RenderAssets. */
export interface ImageTarget {
  addImage(contentId: string, mime: string, bytes: Uint8Array): void;
}