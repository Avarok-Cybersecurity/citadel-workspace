/**
 * The page: a file input, then the document in the shipped editor (DocsCanvas: ribbons, document
 * bar with its one "Download as…", page view, status bar) laid out as DocumentHost lays it out.
 * One document per page load, as the protocol opens one per fresh tab. The replica keeper opens
 * the file's bytes; everything else is the product's.
 */
import { lazy, Suspense, useMemo, useState, type ChangeEvent, type LazyExoticComponent } from 'react';
import type { DocsCanvasProps } from '@/components/documents/DocsCanvas';
import type { DocumentEditing, ReplicaKeeper } from '@/components/documents/use-docs-document';
import type { DocumentSource } from '@/lib/cdoc/document-source';
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import { loadCdocRuntime, type CdocRuntimeFactory } from '@/lib/cdoc/runtime-loader';
import type { CdocRuntime } from '@/lib/cdoc/runtime';
import type { ActionGate } from '@/hooks/use-permission-result';
import { browserDocumentFiles } from '@/lib/document-files';
import { keystrokePaint, type KeystrokePaint } from './instrument';

const DocsCanvas: LazyExoticComponent<(props: DocsCanvasProps) => JSX.Element> = lazy(() => import('@/components/documents/DocsCanvas'));

/** Editable: DocsCanvas opens a replica through the keeper, which opens the file's bytes. */
const EDITABLE: DocumentSource = { kind: 'blank' };
const MAY_EDIT: ActionGate = { enabled: true, reason: null };
const probe: KeystrokePaint = keystrokePaint(window);
const loadRuntime: CdocRuntimeFactory = async (): Promise<CdocRuntime> => {
  const runtime: CdocRuntime = await loadCdocRuntime();
  return { ...runtime, renderer: probe.renderer(runtime.renderer) };
};

interface Opened {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** Edits a replica of the file's bytes, kept for the page's life. */
function fileEditing(file: Opened): DocumentEditing {
  const keep: ReplicaKeeper = (open, show, fail): (() => Promise<void>) => {
    let live: boolean = true;
    let held: EditorSession | null = null;
    let unwatch: (() => void) | null = null;
    open({ kind: 'bytes', bytes: file.bytes, format: 'docx' }).then(
      (editor: EditorSession): void => {
        if (!live) return editor.dispose();
        held = editor;
        unwatch = probe.session(editor);
        show(editor);
      },
      (error: unknown): void => {
        if (live) fail(error);
      },
    );
    return async (): Promise<void> => {
      live = false;
      unwatch?.();
      held?.dispose();
    };
  };
  return { kind: 'replica', keep, save: null, pictures: null };
}

export function BenchHarness(): JSX.Element {
  const [file, setFile] = useState<Opened | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusBar, setStatusBar] = useState<HTMLElement | null>(null);
  const editing: DocumentEditing | null = useMemo(() => (file === null ? null : fileEditing(file)), [file]);
  const choose = (e: ChangeEvent<HTMLInputElement>): void => {
    const chosen: File | undefined = e.target.files?.[0];
    if (chosen === undefined) return;
    if (!/\.docx$/i.test(chosen.name)) return setError(`${chosen.name} is not a .docx`);
    chosen.arrayBuffer().then(
      (buffer: ArrayBuffer): void => setFile({ name: chosen.name, bytes: new Uint8Array(buffer) }),
      (reason: unknown): void => setError(reason instanceof Error ? reason.message : String(reason)),
    );
  };
  return (
    <div className="flex h-full min-w-0 flex-col bg-background" data-testid="document-host">
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h1 className="truncate text-lg font-semibold text-foreground">{file?.name ?? 'Citadel Docs bench harness'}</h1>
        {file === null && (
          <label className="text-sm">
            Open a .docx <input type="file" accept=".docx" data-testid="bench-open" onChange={choose} />
          </label>
        )}
      </header>
      {error !== null && <p role="alert" className="p-2 text-sm text-destructive">{error}</p>}
      <section aria-label="Citadel Docs editor" data-testid="document-editor-region" className="flex min-h-0 flex-1 flex-col">
        {file !== null && editing !== null && (
          <Suspense fallback={<p role="status" className="m-auto text-sm text-muted-foreground">Loading Citadel Docs…</p>}>
            <DocsCanvas documentSource={EDITABLE} loadRuntime={loadRuntime} editing={editing} statusBar={statusBar} edit={MAY_EDIT} commentAuthor="Benchmark"
              title={file.name.replace(/\.docx$/i, '')} files={browserDocumentFiles} original={null} />
          </Suspense>
        )}
      </section>
      <footer ref={setStatusBar} data-testid="document-status-bar" className="border-t border-border px-4 py-1.5" />
    </div>
  );
}
