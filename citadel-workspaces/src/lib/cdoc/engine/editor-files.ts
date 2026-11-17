/**
 * Files in and out of an editing session: EditorHandle.fromDocument opens a replica on a
 * file's bytes, EditorHandle.export writes the live replica as a file (docs/edit-commands.md
 * § Files). The options are exact (the engine refuses a missing or unknown field), built here
 * from the format and engine-limits.ts. Reports stay JSON text: the page reads them.
 */
import type { CdocWasm, EditorHandle, EditorSealedFonts, FileExport, ImageStore, ImportedEditor } from './cdoc-wasm-api';
import type { ExportTarget, ImportFormat } from '../editor/file-formats';
import { MAX_IMAGE_BYTES, MD_READ_OPTIONS, PACKAGE_READ_OPTIONS, TXT_READ_OPTIONS } from './engine-limits';

export interface OpenedFromFile {
  readonly handle: EditorHandle;
  /** `{"report", "problems", "kind"}`. */
  readonly reportJson: string;
}

export interface WrittenFile {
  /** A copy out of wasm memory: it owns its buffer. */
  readonly bytes: Uint8Array;
  /** `{"losses": [...]}`. */
  readonly reportJson: string;
}

function importOptions(format: ImportFormat): object {
  switch (format) {
    case 'docx': case 'odt': return PACKAGE_READ_OPTIONS;
    case 'md': return MD_READ_OPTIONS;
    case 'txt': return TXT_READ_OPTIONS;
  }
}

export function openFromFile(wasm: CdocWasm, fonts: EditorSealedFonts, client: bigint, bytes: Uint8Array, format: ImportFormat): OpenedFromFile {
  const imported: ImportedEditor = wasm.EditorHandle.fromDocument(bytes, format, JSON.stringify(importOptions(format)), client, fonts, MAX_IMAGE_BYTES);
  let reportJson: string;
  try {
    reportJson = imported.reportJson();
  } catch (error: unknown) {
    imported.free();
    throw error;
  }
  // editor() spends the ImportedEditor: it hands over the session and frees itself.
  return { handle: imported.editor(), reportJson };
}

/** The formats the editor artefact writes: all but PDF, which is the PDF artefact's. */
export type DocumentExportTarget = Exclude<ExportTarget, { readonly format: 'pdf' }>;

function exportCall(target: DocumentExportTarget): { readonly kind: string; readonly options: object } {
  switch (target.format) {
    case 'docx': return { kind: 'docx', options: { kind: 'document' } };
    case 'dotx': return { kind: 'docx', options: { kind: 'template' } };
    case 'odt': return { kind: 'odt', options: { kind: 'document' } };
    case 'md': return { kind: 'md', options: {} };
    case 'txt': return { kind: 'txt', options: {} };
  }
}

/**
 * The live replica as a file. Its images come from the session (added or imported); images
 * that arrived from peers live in the workspace's content store, which this does not reach yet,
 * so they are not in `images` and export as the engine's placeholders.
 */
export function writeFile(wasm: CdocWasm, handle: EditorHandle, target: DocumentExportTarget): WrittenFile {
  const { kind, options } = exportCall(target);
  const images: ImageStore = new wasm.ImageStore();
  try {
    const file: FileExport = handle.export(kind, JSON.stringify(options), images);
    try {
      return { bytes: file.bytes(), reportJson: file.reportJson() };
    } finally {
      file.free();
    }
  } finally {
    images.free();
  }
}
