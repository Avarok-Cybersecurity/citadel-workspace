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
 * - `?save=controls`: the title bar's save controls over a control no session binds;
 *   `window.docsHarnessSaveInputs(inputs)` sets where the edits are, for the geometry check
 *   (check-docs-pane-states.mjs) to step the status through every state.
 */
import { createRoot, type Root } from 'react-dom/client';
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

const save: BindableSaveControl | null = params.get('save') === 'controls' ? saveControl('harness') : null;
if (save !== null) window.docsHarnessSaveInputs = (inputs: SaveInputs): void => save.inputs.set(inputs);
const EDITING: DocumentEditing = { kind: 'replica', keep: doc === null ? keepBlankReplica : keepFile(doc), save, pictures: null };
const app: Root = createRoot(root);
app.render(
  // min-h-0: #root is a flex column (index.css), and a flex item does not shrink below its
  // content without it, so the page view would grow to the document's height instead of scrolling.
  <div className="h-screen min-h-0" style={{ paddingLeft: offset }}>
    <DocumentHost
      nodeId="harness" appId="docs" title="Harness" permissions={{ edit: { enabled: true, reason: null } }}
      documentSource={{ kind: 'blank' }} loadCdocRuntime={loadCdocRuntime} commentAuthor="Harness"
      files={browserDocumentFiles} original={null} editing={EDITING}
    />
  </div>,
);
