/**
 * What DocsCanvas shows, from loading cdoc to an open document. Docs' own JSON is laid out
 * read-only by the engine (PageView). A blank document or a file opens as a replica: an editable
 * one is opened and kept by the caller's ReplicaKeeper; a read-only one is opened here, kept by
 * no one, never collaborates, and is disposed with the view. A file whose macros the importer
 * refused is not shown at all: its replica is disposed at once and the report says why.
 */
import type { SaveControl } from './save/save-control';
import { useEffect, useState } from 'react';
import { isStaticSource, replicaOrigin, type DocumentSource } from '@/lib/cdoc/document-source';
import type { CdocRuntimeFactory } from '@/lib/cdoc/runtime-loader';
import type { CdocRuntime } from '@/lib/cdoc/runtime';
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import type { ImportReport } from '@/lib/cdoc/editor/file-formats';
import type { EditorOrigin } from '@/lib/cdoc/editor/controller';
import { createEditorOpener } from '@/lib/cdoc/editor/editor-opener';
import { refusedMacros } from '@/lib/cdoc/conversion-report';

/**
 * Opens and keeps the page's replica: calls `open` (this runtime's EditorOpener) as often as it
 * needs, and `show` with each replica the page should draw (a re-open replaces the previous one,
 * which the keeper disposes). Returns the teardown, which resolves once the keeper is done with
 * every replica it opened: the runtime is disposed only then, so a keeper's last write (a chat
 * document's snapshot) still has the engine. DocsCanvas never disposes a replica it was shown:
 * the keeper owns replica lifetimes.
 */
export type ReplicaKeeper = (
  open: (from: EditorOrigin) => Promise<EditorSession>,
  show: (editor: EditorSession) => void,
  fail: (error: unknown) => void,
) => () => Promise<void>;

/** Whether the document is edited through a kept replica, or only read, and then why. */
export type DocumentEditing =
  /**
   * `save`: the title bar's controls for where its edits are; null for a replica nobody keeps
   * anywhere. `pictures`: why a picture cannot be inserted here, or null where it can.
   */
  | { readonly kind: 'replica'; readonly keep: ReplicaKeeper; readonly save: SaveControl | null; readonly pictures: string | null }
  | { readonly kind: 'readOnly'; readonly reason: string };

export type DocsDocument =
  /** cdoc is loading. */
  | { readonly kind: 'loading' }
  /** cdoc is up and the replica is opening; `runtime.engineLoad` says how far its engine has got. */
  | { readonly kind: 'opening'; readonly runtime: CdocRuntime }
  | { readonly kind: 'failed'; readonly stage: 'start' | 'open'; readonly message: string }
  | { readonly kind: 'static'; readonly runtime: CdocRuntime }
  | { readonly kind: 'replica'; readonly runtime: CdocRuntime; readonly editor: EditorSession; readonly editable: boolean }
  | { readonly kind: 'refused'; readonly report: ImportReport };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function useDocsDocument(loadRuntime: CdocRuntimeFactory, source: DocumentSource, editing: DocumentEditing): DocsDocument {
  const [state, setState] = useState<DocsDocument>({ kind: 'loading' });
  useEffect((): (() => void) => {
    let live: boolean = true;
    let loaded: CdocRuntime | null = null;
    let release: (() => Promise<void>) | null = null;
    let held: EditorSession | null = null;
    const set = (next: DocsDocument): void => {
      if (live) setState(next);
    };
    setState({ kind: 'loading' });
    loadRuntime().then((runtime: CdocRuntime): void => {
      loaded = runtime;
      if (!live) return runtime.client.dispose();
      if (isStaticSource(source)) return set({ kind: 'static', runtime });
      set({ kind: 'opening', runtime });
      const open: (from: EditorOrigin) => Promise<EditorSession> = createEditorOpener(
        { client: runtime.client, renderer: runtime.renderer }, (b: Uint8Array): Uint8Array => crypto.getRandomValues(b),
      );
      if (editing.kind === 'replica') {
        release = editing.keep(open, (editor: EditorSession): void => set({ kind: 'replica', runtime, editor, editable: true }), (error: unknown): void => set({ kind: 'failed', stage: 'open', message: messageOf(error) }));
        return;
      }
      open(replicaOrigin(source)).then(
        (editor: EditorSession): void => {
          const report: ImportReport | null = editor.importReport;
          if (!live || (report !== null && refusedMacros(report).length > 0)) editor.dispose();
          else held = editor;
          if (report !== null && refusedMacros(report).length > 0) return set({ kind: 'refused', report });
          set({ kind: 'replica', runtime, editor, editable: false });
        },
        (error: unknown): void => set({ kind: 'failed', stage: 'open', message: messageOf(error) }),
      );
    }).then(
      (): void => undefined,
      (error: unknown): void => set({ kind: 'failed', stage: 'start', message: messageOf(error) }),
    );
    return (): void => {
      live = false;
      const released: Promise<void> = release?.() ?? Promise.resolve();
      held?.dispose();
      // After the keeper is done: it may still be writing what was last typed, through the engine.
      const runtime: CdocRuntime | null = loaded;
      const dispose = (): void => runtime?.client.dispose();
      released.then(dispose, dispose);
    };
  }, [loadRuntime, source, editing]);
  return state;
}
