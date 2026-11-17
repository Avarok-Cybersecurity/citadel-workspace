/**
 * "Download as…": the engine writes the open document in the chosen format, the bytes come
 * back as a moved buffer and are handed to the person as a file. One export at a time; its
 * report (what the format could not carry) and any failure are kept to be shown, never dropped.
 */
import { useCallback, useState } from 'react';
import { DOCS_FORMATS, exportFileName } from '@/lib/citadel-apps/docs-file-kinds';
import type { ConversionReport, ExportedFile, ExportFormat, ExportTarget } from '@/lib/cdoc/editor/file-formats';
import type { DocumentFiles } from '@/lib/document-files';

export type ExportState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'exporting'; readonly format: ExportFormat }
  /** `report` null: the format's writer reports nothing (a PDF: pm_to_pdf returns bytes only). */
  | { readonly kind: 'saved'; readonly format: ExportFormat; readonly name: string; readonly report: ConversionReport | null }
  | { readonly kind: 'failed'; readonly format: ExportFormat; readonly message: string };

/** Writes the open document in another format: the read-only document's engine, or the editor's. */
export type DocsExporter = (target: ExportTarget) => Promise<ExportedFile>;

export interface DocsExport {
  readonly state: ExportState;
  readonly run: (format: ExportFormat) => void;
}

function targetFor(format: ExportFormat, files: DocumentFiles): ExportTarget {
  return format === 'pdf' ? { format, nowRfc3339: files.nowRfc3339() } : { format };
}

export function useDocsExport(exporter: DocsExporter, title: string, files: DocumentFiles): DocsExport {
  const [state, setState] = useState<ExportState>({ kind: 'idle' });
  const run: (format: ExportFormat) => void = useCallback((format: ExportFormat): void => {
    setState({ kind: 'exporting', format });
    exporter(targetFor(format, files)).then(
      (out: ExportedFile): void => {
        const name: string = exportFileName(title, format);
        files.save({ bytes: out.bytes, mime: DOCS_FORMATS[format].mime, name });
        setState({ kind: 'saved', format, name, report: out.report });
      },
      (error: unknown): void => setState({ kind: 'failed', format, message: error instanceof Error ? error.message : String(error) }),
    );
  }, [exporter, title, files]);
  return { state, run };
}
