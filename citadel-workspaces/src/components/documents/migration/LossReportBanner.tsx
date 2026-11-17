/**
 * Said above a chat document that moved to Citadel Docs: what the move could not carry (the
 * existing ConversionReportPanel, every entry, its severity labels), a conflict with a peer's
 * move when there was one, and "Show original" for the document as it was, read-only.
 *
 * Its I/O arrives as props: `loadOriginal` reads the kept original (boot.ts's
 * loadOriginalDocument in the product), `files` saves the .txt, `loadCdocRuntime` lays out pages.
 */
import type { ConversionReport } from '@/lib/cdoc/editor/file-formats';
import type { CdocRuntimeFactory } from '@/lib/cdoc/runtime-loader';
import type { DocumentFiles } from '@/lib/document-files';
import type { ConflictRecord } from '@/lib/live-doc-migration/conflict-record';
import type { OriginalDocument } from '@/lib/live-doc-migration/migration-report';
import { CONFLICT_NOTES, MIGRATION_REPORT_TITLE } from '@/lib/live-doc-migration/migration-copy';
import { ConversionReportPanel } from '../page-view/ConversionReportPanel';
import { ShowOriginal } from './ShowOriginal';

export interface LossReportBannerProps {
  readonly docId: string;
  readonly report: ConversionReport;
  readonly conflict: ConflictRecord['resolution'] | null;
  readonly loadOriginal: () => Promise<OriginalDocument | null>;
  readonly files: DocumentFiles;
  readonly loadCdocRuntime: CdocRuntimeFactory;
}

export function LossReportBanner({ docId, report, conflict, loadOriginal, files, loadCdocRuntime }: LossReportBannerProps): JSX.Element {
  return (
    <div data-testid="migration-loss-banner" className="flex min-w-0 flex-col border-b border-border bg-background">
      <ConversionReportPanel title={MIGRATION_REPORT_TITLE} report={report} testId="migration-loss-report" />
      <div className="flex min-w-0 flex-col gap-[4px] px-[16px] pb-[8px] text-sm">
        {conflict !== null && <p role="status" data-testid="migration-conflict" className="min-w-0 text-foreground">{CONFLICT_NOTES[conflict]}</p>}
        <ShowOriginal docId={docId} loadOriginal={loadOriginal} files={files} loadCdocRuntime={loadCdocRuntime} />
      </div>
    </div>
  );
}
