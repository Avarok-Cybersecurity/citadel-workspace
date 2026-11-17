/**
 * A migrated chat document's original, read-only: laid out by Citadel Docs from its static
 * `pm` source when the mapper could make one, otherwise its text, with a .txt download either
 * way. Never editable, never a replica: the original is kept, not continued.
 */
import { useMemo } from 'react';
import { Download } from 'lucide-react';
import type { DocumentSource } from '@/lib/cdoc/document-source';
import type { CdocRuntimeFactory } from '@/lib/cdoc/runtime-loader';
import type { DocumentFiles } from '@/lib/document-files';
import type { OriginalDocument } from '@/lib/live-doc-migration/migration-report';
import { DOWNLOAD_ORIGINAL_TEXT, ORIGINAL_AS_TEXT_NOTE, ORIGINAL_NOTE, originalTextFileName } from '@/lib/live-doc-migration/migration-copy';
import { DocumentHost, type DocumentPermissions } from '../DocumentHost';
import type { DocumentEditing } from '../use-docs-document';

interface OriginalDocumentViewProps {
  readonly docId: string;
  readonly original: OriginalDocument;
  readonly files: DocumentFiles;
  readonly loadCdocRuntime: CdocRuntimeFactory;
}

const READ_ONLY: DocumentPermissions = { edit: { enabled: false, reason: ORIGINAL_NOTE } };
const NOT_EDITED: DocumentEditing = { kind: 'readOnly', reason: ORIGINAL_NOTE };

export function OriginalDocumentView({ docId, original, files, loadCdocRuntime }: OriginalDocumentViewProps): JSX.Element {
  // One identity per original: a new source object would re-open the document on every render.
  const source: DocumentSource | null = useMemo(
    (): DocumentSource | null => (original.docsPm === null ? null : { kind: 'pm', pmJson: original.docsPm }),
    [original.docsPm],
  );
  const download = (): void => files.save({ bytes: new TextEncoder().encode(original.text), mime: 'text/plain;charset=utf-8', name: originalTextFileName(original.title) });
  return (
    <section aria-label={`Original of ${original.title}`} data-testid="migration-original" className="flex min-w-0 flex-col gap-[8px] border-t border-border pt-[8px]">
      <div className="flex min-h-[44px] min-w-0 flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px]">
        <p className="min-w-0 flex-1 basis-[200px] text-muted-foreground">{source === null ? ORIGINAL_AS_TEXT_NOTE : ORIGINAL_NOTE}</p>
        <button
          type="button"
          data-testid="migration-original-download"
          onClick={download}
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center gap-[4px] rounded px-[8px] text-primary-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="h-[16px] w-[16px]" aria-hidden="true" />
          {DOWNLOAD_ORIGINAL_TEXT}
        </button>
      </div>
      {source === null ? (
        <pre data-testid="migration-original-text" dir="auto" className="max-h-[60vh] min-w-0 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted p-[12px] font-sans text-sm text-foreground">
          {original.text}
        </pre>
      ) : (
        <div data-testid="migration-original-pages" className="flex h-[60vh] min-w-0 flex-col overflow-hidden rounded border border-border">
          <DocumentHost
            nodeId={docId} appId="docs" title={original.title} permissions={READ_ONLY} documentSource={source}
            loadCdocRuntime={loadCdocRuntime} commentAuthor={null} files={files} original={null} editing={NOT_EDITED}
          />
        </div>
      )}
    </section>
  );
}
