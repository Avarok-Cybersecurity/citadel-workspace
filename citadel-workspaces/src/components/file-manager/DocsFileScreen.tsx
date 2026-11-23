/**
 * A file manager file opened in Citadel Docs: a bar to go back to its folder or download the
 * original, then the file's bytes in Docs (DocsFileView), read through the agent.
 */
import { useCallback, useMemo } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import type { CdocRuntimeFactory } from '@/lib/cdoc/runtime-loader';
import type { DocumentFiles } from '@/lib/document-files';
import type { RevfsNode } from '@/types/revfs-types';
import type { OriginalFile } from '@/components/documents/NotOpened';
import { DocsFileView } from '@/components/documents/DocsFileView';
import type { WorkspaceFileReader } from './docs-file-open';

const BAR_BUTTON: string = 'inline-flex min-h-[44px] items-center gap-[8px] rounded px-[12px] text-sm text-foreground hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export interface DocsFileScreenProps {
  readonly node: RevfsNode;
  readonly folderName: string;
  readonly onBack: () => void;
  readonly onDownload: () => void;
  readonly reader: WorkspaceFileReader;
  readonly loadCdocRuntime: CdocRuntimeFactory;
  readonly files: DocumentFiles;
}

export function DocsFileScreen({ node, folderName, onBack, onDownload, reader, loadCdocRuntime, files }: DocsFileScreenProps): JSX.Element {
  const original: OriginalFile = useMemo((): OriginalFile => ({ name: node.name, download: onDownload }), [node.name, onDownload]);
  const read: () => Promise<Uint8Array> = useCallback((): Promise<Uint8Array> => reader.read(node), [reader, node]);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="docs-file-screen">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-[8px] border-b border-border px-[8px]">
        <button type="button" className={BAR_BUTTON} onClick={onBack} data-testid="docs-file-back">
          <ArrowLeft className="h-[16px] w-[16px]" aria-hidden="true" />Back to {folderName}
        </button>
        <button type="button" className={BAR_BUTTON} onClick={onDownload}>
          <Download className="h-[16px] w-[16px]" aria-hidden="true" />Download original
        </button>
      </div>
      <DocsFileView fileId={node.path} original={original} mime={node.fileMetadata?.fileType ?? ''} read={read} loadCdocRuntime={loadCdocRuntime} files={files} />
    </div>
  );
}
