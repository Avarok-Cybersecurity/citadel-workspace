/**
 * Where a document node opens: the host an app's editor mounts inside.
 *
 * Citadel Docs mounts its page view in the editor region (lazily: neither the view nor cdoc
 * is in the shell's bundle) and fills the status bar the host reserves at the bottom. Apps
 * without an editor yet keep the placeholder. The host does no I/O: what the person may do
 * arrives in `permissions`, what to open in `documentSource`, how to start cdoc in
 * `loadCdocRuntime`, and whether a kept replica is edited or the document only read in
 * `editing`, all decided by the caller.
 */
import { lazy, Suspense, useState, type KeyboardEvent, type LazyExoticComponent } from 'react';
import { citadelApp, type CitadelApp, type CitadelAppId } from '@/lib/citadel-apps/registry';
import type { ActionGate } from '@/hooks/use-permission-result';
import type { DocumentSource } from '@/lib/cdoc/document-source';
import type { CdocRuntimeFactory } from '@/lib/cdoc/runtime-loader';
import type { DocumentFiles } from '@/lib/document-files';
import type { DocsCanvasProps } from './DocsCanvas';
import type { DocumentEditing } from './use-docs-document';
import type { OriginalFile } from './NotOpened';
import { DocumentSaveControls, saveShortcut } from './save/DocumentSaveControls';
import type { SaveControl } from './save/save-control';
import { AppLoadingPane } from '@/components/app-loading/AppLoadingPane';
import { browserClock } from '@/lib/browser-clock';
import { SAVE_INDICATOR_TIMING } from '@/lib/document-save/save-indicator-timing';
import type { LoadStage } from '@/lib/app-loading/load-stage';

const APP_CODE_LOADING: LoadStage = { kind: 'app' };

const DocsCanvas: LazyExoticComponent<(props: DocsCanvasProps) => JSX.Element> = lazy(() => import('./DocsCanvas'));

export interface DocumentPermissions {
  /** Whether the person may change the document, and when not, the reason to show. */
  edit: ActionGate;
}

export interface DocumentHostProps {
  nodeId: string;
  appId: CitadelAppId;
  /** The node's name, which is the document's title. */
  title: string;
  permissions: DocumentPermissions;
  /** What the editor opens. R1 opens a blank document; the stored content wires up next. */
  documentSource: DocumentSource;
  loadCdocRuntime: CdocRuntimeFactory;
  /** The name new comments are signed with; null until the person's name has loaded. */
  commentAuthor: string | null;
  /** Where downloads go and the time they record. */
  files: DocumentFiles;
  /** The file this document was opened from, offered when Docs refuses it; null for a workspace document. */
  original: OriginalFile | null;
  /** A kept replica to edit, or read only and why (a read-only document opens no kept replica); must keep its identity across renders. */
  editing: DocumentEditing;
}

export function DocumentHost({ nodeId, appId, title, permissions, documentSource, loadCdocRuntime, commentAuthor, files, original, editing }: DocumentHostProps): JSX.Element {
  const app: CitadelApp = citadelApp(appId);
  const Icon: CitadelApp['icon'] = app.icon;
  const [statusBar, setStatusBar] = useState<HTMLElement | null>(null);
  const save: SaveControl | null = editing.kind === 'replica' ? editing.save : null;
  const onSaveKey: ((event: KeyboardEvent<HTMLElement>) => void) | undefined = saveShortcut(save);
  return (
    <div className="flex h-full min-w-0 flex-col bg-background" data-testid="document-host" data-node-id={nodeId} data-app={appId}>
      <header className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-foreground" title={title}>{title}</h1>
          <p className="truncate text-xs text-muted-foreground">{app.name}</p>
        </div>
        {save !== null && <DocumentSaveControls control={save} clock={browserClock} timing={SAVE_INDICATOR_TIMING} />}
      </header>
      {!permissions.edit.enabled && (
        <p role="status" data-testid="document-read-only" className="border-b border-border px-4 py-2 text-sm text-muted-foreground sm:px-6">
          Read only. {permissions.edit.reason}
        </p>
      )}
      {appId === 'docs' ? (
        <section aria-label={`${app.name} editor`} data-testid="document-editor-region" className="flex min-h-0 flex-1 flex-col" onKeyDownCapture={onSaveKey}>
          <Suspense fallback={<AppLoadingPane appName={app.name} stage={APP_CODE_LOADING} />}>
            <DocsCanvas documentSource={documentSource} loadRuntime={loadCdocRuntime} editing={editing} statusBar={statusBar} edit={permissions.edit} commentAuthor={commentAuthor} title={title} files={files} original={original} />
          </Suspense>
        </section>
      ) : (
        <section
          aria-label={`${app.name} editor`}
          data-testid="document-editor-region"
          className="m-4 flex flex-1 items-center justify-center rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground sm:m-6"
        >
          {app.name} editor loads here
        </section>
      )}
      <footer ref={setStatusBar} data-testid="document-status-bar" className="border-t border-border px-4 py-1.5 sm:px-6" />
    </div>
  );
}

/** A node that names an app this client cannot read: said plainly, never opened as a page. */
export function UnreadableDocument({ title, reason }: { title: string; reason: string }): JSX.Element {
  return (
    <div className="flex h-full flex-col gap-2 bg-background p-6" data-testid="document-unreadable">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      <p role="alert" className="text-sm text-muted-foreground">
        This document cannot be opened here. {reason} Updating Citadel may fix this.
      </p>
    </div>
  );
}
