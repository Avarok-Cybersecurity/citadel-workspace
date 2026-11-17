/**
 * The bar over a Docs document: what opening a file cost (its import report), the
 * "Download as…" menu while the document is open, and what the last download cost or why it
 * failed. DocsCanvas decides what each is from the open's outcome; this only shows them.
 */
import type { ConversionReport } from '@/lib/cdoc/editor/file-formats';
import type { DocumentFiles } from '@/lib/document-files';
import { ConversionReportPanel } from './ConversionReportPanel';
import { DownloadAsMenu, DOWNLOAD_AS_TRIGGER } from './DownloadAsMenu';
import { Download } from 'lucide-react';
import { DOCS_FORMATS } from '@/lib/citadel-apps/docs-file-kinds';
import { useDocsExport, type DocsExport, type DocsExporter, type ExportState } from './useDocsExport';

/** Not known yet: the document is still opening. The bar holds its place, so the pages below do not move. */
export const PENDING = 'pending' as const;
export type Pending = typeof PENDING;

interface DocsDocumentBarProps {
  readonly title: string;
  readonly files: DocumentFiles;
  /** The import report of a document converted from a file; null when it was not converted, or failed. */
  readonly importReport: ConversionReport | Pending | null;
  /** Whether the engine refused to open the file; its report then says why, not what opening cost. */
  readonly refused: boolean;
  /** Null when there is nothing to download (refused, or failed to open). */
  readonly exporter: DocsExporter | Pending | null;
}

export function DocsDocumentBar({ title, files, importReport, refused, exporter }: DocsDocumentBarProps): JSX.Element | null {
  if (importReport === null && exporter === null) return null;
  const heading: string = refused ? `Why ${title} was not opened` : `Opening ${title}`;
  return (
    <div data-testid="docs-document-bar">
      {importReport === PENDING && <p className={`${ROW} text-muted-foreground`}>Opening {title}…</p>}
      {importReport !== null && importReport !== PENDING && <ConversionReportPanel title={heading} report={importReport} testId="docs-import-report" />}
      {exporter === PENDING && (
        <div className={`${ROW} justify-end`}>
          <button type="button" aria-disabled="true" data-testid="docs-download-as-pending" className={DOWNLOAD_AS_TRIGGER}>
            <Download className="h-[16px] w-[16px]" aria-hidden="true" />Download as…
          </button>
        </div>
      )}
      {exporter !== null && exporter !== PENDING && <ExportRow exporter={exporter} title={title} files={files} />}
    </div>
  );
}

const ROW: string = 'flex min-h-[44px] min-w-0 items-center border-b border-border bg-background px-[16px] py-[4px] text-sm';

/** What the live region says: progress, then the outcome (a failure is the alert's to say). */
function announcement(state: ExportState, title: string): string {
  if (state.kind === 'exporting') return `Preparing ${title} as .${DOCS_FORMATS[state.format].extension}…`;
  return state.kind === 'saved' ? `Downloaded ${state.name}.` : '';
}

function ExportRow({ exporter, title, files }: { readonly exporter: DocsExporter; readonly title: string; readonly files: DocumentFiles }): JSX.Element {
  const { state, run }: DocsExport = useDocsExport(exporter, title, files);
  return (
    <>
      <p role="status" data-testid="docs-export-status" className="sr-only">{announcement(state, title)}</p>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-[12px] border-b border-border bg-background px-[16px]">
        {state.kind === 'failed' && (
          <p role="alert" data-testid="docs-export-error" className="min-w-0 flex-1 text-sm text-destructive">
            Could not download as .{DOCS_FORMATS[state.format].extension}. Try another format. ({state.message})
          </p>
        )}
        <DownloadAsMenu state={state} onExport={run} />
      </div>
      {state.kind === 'saved' && state.report !== null && <ConversionReportPanel title={`Downloaded ${state.name}`} report={state.report} testId="docs-export-report" />}
      {/* A PDF's writer reports nothing to list: it is the laid-out pages the view shows. */}
      {state.kind === 'saved' && state.report === null && (
        <p data-testid="docs-export-report" className="flex min-h-[44px] items-center border-b border-border bg-background px-[16px] text-sm text-foreground">Downloaded {state.name}</p>
      )}
    </>
  );
}
