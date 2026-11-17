/**
 * A document shared in a node's chat, in the Citadel Docs canvas. A direct chat's lives between
 * the two agents; a channel's readers are many and mostly offline, so this one lives on the
 * workspace server, on its own log beside the node's page, through the same DocumentSession the
 * page uses (`chatDocumentReplicaKeeper`). It is encrypted to the server, as the channel's
 * messages are. Loaded on first open, so neither the session nor cdoc is in the shell's bundle.
 *
 * Always live, so there is no Save control. Its title is the sharing message's, and nothing
 * carries a rename yet, so none is offered.
 */
import { toast } from 'sonner';
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import type { DocumentSessionError } from '@/lib/cdoc/collab/session-errors';
import { createValueStore } from '@/lib/value-store';
import type { ChatDocument, ChatDocumentRequest } from './chat-replica';
import type { ReplicaKeeper } from './use-docs-document';
import { limitNoticeDetail } from '@/lib/chat/chat-document-limit';

export const CHANNEL_PICTURES_UNAVAILABLE: string = 'Pictures cannot be added to a chat document yet: the channel\'s readers would see an empty box where the picture is.';

/** A document of `nodeId`'s chat. `managesSubscription` is read when a notice is shown: whether to say where packs are bought. */
export function openNodeChatDocument(nodeId: string, request: ChatDocumentRequest, managesSubscription: () => boolean): ChatDocument {
  const keep: ReplicaKeeper = (open, show, fail): (() => Promise<void>) => {
    let live: boolean = true;
    let release: (() => Promise<void>) | null = null;
    // The creator's typed text goes into the first replica shown: the id is new, so the log is empty.
    let seed: string | null = request.origin.kind === 'seeded' ? request.origin.text : null;
    Promise.all([import('@/lib/cdoc/collab/replica-keeper'), import('@/lib/cdoc/chat/chat-replica-keeper')]).then(
      ([{ chatDocumentReplicaKeeper }, { seed: typeSeed }]): void => {
        if (!live) return;
        // One notice per document and kind of problem: a repeat updates it instead of stacking.
        const report = (problem: DocumentSessionError): void => {
          const description: string | undefined = limitNoticeDetail(problem.problem, managesSubscription());
          toast.error(problem.message, { id: `node-chat-document:${request.docId}:${problem.problem.kind}`, description });
        };
        const shown = (editor: EditorSession): void => {
          show(editor);
          if (seed === null) return;
          const text: string = seed;
          seed = null;
          typeSeed(editor, text).catch(fail);
        };
        release = chatDocumentReplicaKeeper<EditorSession>(nodeId, request.docId, report)(open, shown, fail);
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
  return {
    editing: { kind: 'replica', keep, save: null, pictures: CHANNEL_PICTURES_UNAVAILABLE },
    title: createValueStore<string>(`node-chat-document-title:${request.docId}`, request.title),
    rename: null,
  };
}
