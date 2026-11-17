/**
 * The keeper for a document shared over the workspace: its replica is opened and kept by a
 * DocumentSession on this tab's session (lib/cdoc/collab), loaded on first use so neither the
 * session nor cdoc is in the shell's bundle. What the session reports is shown to the person,
 * one notice per kind of problem, so a repeated failure updates its notice instead of stacking.
 * While open, the session drives the title bar's save controls and answers a share's request
 * to sync (lib/document-sync-requests.ts).
 */
import { toast } from 'sonner';
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import type { DocumentSession } from '@/lib/cdoc/collab/document-session';
import type { DocumentSessionError } from '@/lib/cdoc/collab/session-errors';
import { registerDocumentSync } from '@/lib/document-sync-requests';
import { saveControl, type BindableSaveControl } from './save/save-control';
import type { DocumentEditing, ReplicaKeeper } from './use-docs-document';

/** A workspace document's editing arm: kept collaboratively, saved from the title bar. Memoise it per node. */
export function collaborationEditing(nodeId: string): DocumentEditing {
  const save: BindableSaveControl = saveControl(nodeId);
  return { kind: 'replica', keep: collaborationKeeper(nodeId, save), save, pictures: null };
}

export function collaborationKeeper(nodeId: string, save: BindableSaveControl): ReplicaKeeper {
  return (open, show, fail): (() => Promise<void>) => {
    let live: boolean = true;
    let release: (() => Promise<void>) | null = null;
    Promise.all([import('@/lib/cdoc/collab/replica-keeper'), import('@/lib/cdoc/collab/session-errors')]).then(
      ([{ workspaceReplicaKeeper }, { noticeKind }]): void => {
        if (!live) return;
        // One notice per node and kind of problem (each refusal by its name): a repeat updates it.
        const notify = (error: DocumentSessionError): void => { toast.error(error.message, { id: `document-collab:${nodeId}:${noticeKind(error.problem)}` }); };
        const bind = (session: DocumentSession): (() => void) => {
          const unbind: () => void = save.bind(session);
          const unregister: () => void = registerDocumentSync({ nodeId, chatDoc: null }, (): Promise<void> => session.save());
          return (): void => { unregister(); unbind(); };
        };
        const keep: ReplicaKeeper = workspaceReplicaKeeper<EditorSession>(nodeId, notify, bind);
        release = keep(open, show, fail);
      },
      (error: unknown): void => {
        if (live) fail(error);
      },
    );
    return (): Promise<void> => {
      live = false;
      return release?.() ?? Promise.resolve();
    };
  };
}
