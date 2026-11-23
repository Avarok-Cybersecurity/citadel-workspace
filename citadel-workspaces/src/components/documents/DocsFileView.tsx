/**
 * A file's bytes opened in Citadel Docs, read only: the file manager's opened file and a chat
 * file opened in Docs both show this. A file Docs does not open (macro-enabled, another format)
 * is said so, plainly, with the download still offered; so is a file whose bytes could not be read.
 */
import { useEffect, useMemo, useState } from 'react';
import { DocumentHost, type DocumentPermissions } from '@/components/documents/DocumentHost';
import { docsFileRoute, type DocsFileRoute } from '@/lib/citadel-apps/docs-file-kinds';
import type { DocumentSource } from '@/lib/cdoc/document-source';
import type { CdocRuntimeFactory } from '@/lib/cdoc/runtime-loader';
import type { DocumentFiles } from '@/lib/document-files';
import { NotOpened, type OriginalFile } from '@/components/documents/NotOpened';
import type { DocumentEditing } from '@/components/documents/use-docs-document';

/** A file opens read-only: no kept replica, so nothing could be saved back to it. One reason, shown and decided. */
const READ_ONLY_FILE: DocumentEditing = { kind: 'readOnly', reason: 'Changes to an opened file cannot be saved back to it yet.' };
const READ_ONLY: DocumentPermissions = { edit: { enabled: false, reason: READ_ONLY_FILE.reason } };

/** A file opened read-only takes no comments, so nobody signs one. */
const NO_COMMENTS: string | null = null;

export interface DocsFileViewProps {
  /** Where the file is, as the document host names it (a file manager path, a chat file's id). */
  readonly fileId: string;
  readonly original: OriginalFile;
  /** The MIME type the file was stored with; empty when none was recorded. */
  readonly mime: string;
  readonly read: () => Promise<Uint8Array>;
  readonly loadCdocRuntime: CdocRuntimeFactory;
  readonly files: DocumentFiles;
}

type Read = { readonly kind: 'reading' } | { readonly kind: 'read'; readonly bytes: Uint8Array } | { readonly kind: 'failed'; readonly message: string };

function refusalOf(route: Exclude<DocsFileRoute, { kind: 'docs' }>): string {
  return route.kind === 'macro-enabled'
    ? 'This is a macro-enabled Word file. Citadel Docs never runs or keeps macros, so it does not open it.'
    : route.reason;
}

function FileBody({ fileId, original, read: readBytes, route, loadCdocRuntime, files }: Omit<DocsFileViewProps, 'mime'> & { route: Extract<DocsFileRoute, { kind: 'docs' }> }): JSX.Element {
  const [read, setRead] = useState<Read>({ kind: 'reading' });
  useEffect((): (() => void) => {
    let live: boolean = true;
    setRead({ kind: 'reading' });
    readBytes().then(
      (bytes: Uint8Array): void => { if (live) setRead({ kind: 'read', bytes }); },
      (error: unknown): void => { if (live) setRead({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }); },
    );
    return (): void => { live = false; };
  }, [readBytes]);
  const source: DocumentSource | null = useMemo(
    (): DocumentSource | null => (read.kind === 'read' ? { kind: 'file', format: route.format, bytes: read.bytes } : null),
    [read, route.format],
  );
  if (read.kind === 'failed') return <NotOpened original={original} why={read.message} testId="docs-file-unreadable" />;
  if (source === null) return <p role="status" className="m-auto text-sm text-muted-foreground">Reading {original.name}…</p>;
  return <DocumentHost nodeId={fileId} appId="docs" title={original.name} permissions={READ_ONLY} documentSource={source} loadCdocRuntime={loadCdocRuntime} files={files} original={original} commentAuthor={NO_COMMENTS} editing={READ_ONLY_FILE} />;
}

export function DocsFileView({ mime, ...rest }: DocsFileViewProps): JSX.Element {
  const route: DocsFileRoute = docsFileRoute({ name: rest.original.name, mime, app: null });
  return route.kind === 'docs'
    ? <FileBody route={route} {...rest} />
    : <NotOpened original={rest.original} why={refusalOf(route)} testId="docs-file-refused" />;
}
