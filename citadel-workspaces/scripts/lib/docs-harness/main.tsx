/**
 * The shipped document host on a bare page: DocumentHost opening a Citadel Docs document with
 * the real cdoc worker and wasm, and no agent or workspace. Not part of the app: serve.mjs
 * builds it on its own.
 *
 * - With no `doc`: a blank document.
 * - `?doc=<url>`: that DOCX's bytes opened for editing, for measurements that need a long
 *   document (check-cdoc-scroll-perf.mjs).
 * - `?offset=<css px>` shifts the host right by that much (fractional values included),
 *   standing in for whatever the app's sidebar and header widths add.
 * - `?sidebar=1`: the host inside the app's SidebarProvider, whose state is printed in
 *   `[data-testid="harness-sidebar-state"]`, so a check can press the sidebar's shortcut
 *   with the real editor focused (check-docs-pane-states.mjs).
 * - `?save=controls`: the title bar's save controls over a control no session binds;
 *   `window.docsHarnessSaveInputs(inputs)` sets where the edits are, for the geometry check
 *   (check-docs-pane-states.mjs) to step the status through every state.
 * - `?pictures=reopen`: a document kept across `window.docsHarnessReopen()`, its pictures in a
 *   store a check can hold or fail (picture-reopen.ts).
 */
import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar';
import '@/index.css';
import '@/styles/brand-tokens.css';
import { DocumentHost } from '@/components/documents/DocumentHost';
import type { DocumentEditing, ReplicaKeeper } from '@/components/documents/use-docs-document';
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import type { EditorOrigin } from '@/lib/cdoc/editor/controller';
import { loadCdocRuntime } from '@/lib/cdoc/runtime-loader';
import { browserDocumentFiles } from '@/lib/document-files';
import { keepBlankReplica } from '@/components/documents/blank-replica';
import { saveControl, type BindableSaveControl } from '@/components/documents/save/save-control';
import type { SaveInputs } from '@/lib/document-save/save-status';
import type { PicturePlan } from '@/lib/cdoc/pictures/picture-plan';
import { memoryPicturePlan, memoryPictures, type MemoryPictures } from '@/lib/cdoc/pictures/__tests__/doubles/memory-pictures';
import { exposePictures, snapshotKeeper } from './picture-reopen';

declare global {
  interface Window {
    docsHarnessSaveInputs?: (inputs: SaveInputs) => void;
  }
}

const root: HTMLElement | null = document.getElementById('root');
if (root === null) throw new Error('the harness page has no #root');
const params: URLSearchParams = new URLSearchParams(window.location.search);
const offset: number = Number(params.get('offset') ?? '0');
if (!Number.isFinite(offset)) throw new Error('offset must be a number of CSS px');
const doc: string | null = params.get('doc');

/** Opens the DOCX at `url` once, as a replica of its own. */
function keepFile(url: string): ReplicaKeeper {
  return (open: (from: EditorOrigin) => Promise<EditorSession>, show: (editor: EditorSession) => void, fail: (error: unknown) => void): (() => Promise<void>) => {
    let opened: EditorSession | null = null;
    let live: boolean = true;
    fetch(url)
      .then(async (response: Response): Promise<Uint8Array> => {
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      })
      .then((bytes: Uint8Array) => open({ kind: 'bytes', bytes, format: 'docx' }))
      .then((editor: EditorSession): void => {
        if (!live) return editor.dispose();
        opened = editor;
        show(editor);
      }, (error: unknown): void => {
        if (live) fail(error);
      });
    return async (): Promise<void> => {
      live = false;
      opened?.dispose();
    };
  };
}

/** The harness's pictures live in this page's memory: a reopen within the page finds them (check:docs-pane-states). */
const STORE: MemoryPictures = memoryPictures();
const HARNESS_PICTURES: PicturePlan = memoryPicturePlan(STORE, { kind: 'page', nodeId: 'docs-harness' });
const reopening: boolean = params.get('pictures') === 'reopen';
if (reopening) exposePictures(STORE);
const save: BindableSaveControl | null = params.get('save') === 'controls' ? saveControl('harness') : null;
if (save !== null) window.docsHarnessSaveInputs = (inputs: SaveInputs): void => save.inputs.set(inputs);
const EDITING: DocumentEditing = { kind: 'replica', keep: reopening ? snapshotKeeper() : doc === null ? keepBlankReplica : keepFile(doc), save, pictures: HARNESS_PICTURES };
const app: Root = createRoot(root);
function SidebarState(): JSX.Element {
  const { isMobile, openMobile, state } = useSidebar();
  // A phone's sidebar is a sheet, opened and closed; a wider screen's is expanded or collapsed.
  return <output data-testid="harness-sidebar-state" className="sr-only">{isMobile ? (openMobile ? 'open' : 'closed') : state}</output>;
}
/** The host, mounted afresh on every `docsHarnessReopen()` (a closed and reopened document); the same layout otherwise. */
function Host(): JSX.Element {
  const [opening, setOpening] = useState<number>(0);
  if (reopening) window.docsHarnessReopen = (): void => setOpening((n: number): number => n + 1);
  return (
    // min-h-0: #root is a flex column (index.css), and a flex item does not shrink below its
    // content without it, so the page view would grow to the document's height instead of scrolling.
    <div key={opening} className="h-screen min-h-0" style={{ paddingLeft: offset }}>
      <DocumentHost
        nodeId="harness" appId="docs" title="Harness" permissions={{ edit: { enabled: true, reason: null } }}
        documentSource={{ kind: 'blank' }} loadCdocRuntime={loadCdocRuntime} commentAuthor="Harness"
        files={browserDocumentFiles} original={null} editing={EDITING}
      />
    </div>
  );
}
const host: JSX.Element = <Host />;
app.render(params.get('sidebar') === '1' ? <SidebarProvider><SidebarState />{host}</SidebarProvider> : host);
