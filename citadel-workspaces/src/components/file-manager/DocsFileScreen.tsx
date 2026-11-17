/**
 * A file manager file opened in Citadel Docs: a bar to go back to its folder or download the
 * original, then the document host over the file's bytes, imported by the engine in the worker.
 * A file Docs does not open (macro-enabled, another format) is said so here, plainly, with the
 * download still offered; so is a file whose bytes could not be read.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import { DocumentHost, type DocumentPermissions } from '@/components/documents/DocumentHost';
import type { DocsFileRoute } from '@/lib/citadel-apps/docs-file-kinds';
import type { DocumentSource } from '@/lib/cdoc/document-source';
import type { CdocRuntimeFactory } from '@/lib/cdoc/runtime-loader';
import type { DocumentFiles } from '@/lib/document-files';
import type { RevfsNode } from '@/types/revfs-types';
import { NotOpened, type OriginalFile } from '@/components/documents/NotOpened';
// A file opens read-only, so its replica is never opened; the keeper only satisfies the contract.
import type { DocumentEditing } from '@/components/documents/use-docs-document';
import { docsRouteOf, type WorkspaceFileReader } from './docs-file-open';

/** A file opens read-only: saving back to the file manager is not wired yet. */
/** A file opens read-only: no kept replica, so nothing could be saved back to it. One reason, shown and decided. */
const READ_ONLY_FILE: DocumentEditing = { kind: 'readOnly', reason: 'Changes to a file from the file manager cannot be saved back to it yet.' };
const READ_ONLY: DocumentPermissions = { edit: { enabled: false, reason: READ_ONLY_FILE.reason } };

/** A file opened read-only takes no comments, so nobody signs one. */
const NO_COMMENTS: string | null = null;

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

type Read = { readonly kind: 'reading' } | { readonly kind: 'read'; readonly bytes: Uint8Array } | { readonly kind: 'failed'; readonly message: string };

function refusalOf(route: Exclude<DocsFileRoute, { kind: 'docs' }>): string {
  return route.kind === 'macro-enabled'
    ? 'This is a macro-enabled Word file. Citadel Docs never runs or keeps macros, so it does not open it.'
    : route.reason;
}

function FileBody({ node, route, reader, loadCdocRuntime, files, original }: Omit<DocsFileScreenProps, 'folderName' | 'onBack' | 'onDownload'> & { route: Extract<DocsFileRoute, { kind: 'docs' }>; original: OriginalFile }): JSX.Element {
  const [read, setRead] = useState<Read>({ kind: 'reading' });
  useEffect((): (() => void) => {
    let live: boolean = true;
    setRead({ kind: 'reading' });
    reader.read(node).then(
      (bytes: Uint8Array): void => { if (live) setRead({ kind: 'read', bytes }); },
      (error: unknown): void => { if (live) setRead({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }); },
    );
    return (): void => { live = false; };
  }, [reader, node]);
  const source: DocumentSource | null = useMemo(
    (): DocumentSource | null => (read.kind === 'read' ? { kind: 'file', format: route.format, bytes: read.bytes } : null),
    [read, route.format],
  );
  if (read.kind === 'failed') return <NotOpened original={original} why={read.message} testId="docs-file-unreadable" />;
  if (source === null) return <p role="status" className="m-auto text-sm text-muted-foreground">Reading {node.name}…</p>;
  return <DocumentHost nodeId={node.path} appId="docs" title={node.name} permissions={READ_ONLY} documentSource={source} loadCdocRuntime={loadCdocRuntime} files={files} original={original} commentAuthor={NO_COMMENTS} editing={READ_ONLY_FILE} />;
}

export function DocsFileScreen({ node, folderName, onBack, onDownload, ...rest }: DocsFileScreenProps): JSX.Element {
  const route: DocsFileRoute = docsRouteOf(node);
  const original: OriginalFile = useMemo((): OriginalFile => ({ name: node.name, download: onDownload }), [node.name, onDownload]);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="docs-file-screen">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-[8px] border-b border-border px-[8px]">
        <button type="button" className={BAR_BUTTON} onClick={onBack}>
          <ArrowLeft className="h-[16px] w-[16px]" aria-hidden="true" />Back to {folderName}
        </button>
        <button type="button" className={BAR_BUTTON} onClick={onDownload}>
          <Download className="h-[16px] w-[16px]" aria-hidden="true" />Download original
        </button>
      </div>
      {route.kind === 'docs'
        ? <FileBody node={node} route={route} original={original} {...rest} />
        : <NotOpened original={original} why={refusalOf(route)} testId="docs-file-refused" />}
    </div>
  );
}
