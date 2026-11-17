/**
 * A chat document in the Citadel Docs canvas, kept live between the two people of a 1:1 chat
 * over their P2P channel (lib/cdoc/chat): no workspace server, so its content never leaves
 * the two agents. What the chat's wiring opens: `openChatDocument` gives DocumentHost its
 * `editing` arm, the title to show and the rename to offer. Everything it runs is loaded on
 * first open, so neither the sync nor cdoc is in the shell's bundle (types only from cdoc).
 *
 * Always live, so there is no Save control. Pictures cannot be inserted yet: a chat has no
 * content store, so the other person would see an empty box where the picture is.
 */
import { toast } from 'sonner';
import type { EditorSession } from '@/lib/cdoc/editor/editor-session';
import type { CdocChatTitleStamp } from '@/types/cdoc-chat-sync';
import type { ChatDocumentOrigin } from '@/lib/cdoc/chat/chat-replica-keeper';
import type { ChatPeer } from '@/lib/cdoc/chat/chat-app-ports';
import type { ChatDocumentSync } from '@/lib/cdoc/chat/chat-sync';
import type { ChatSyncProblem } from '@/lib/cdoc/chat/chat-problems';
import { createValueStore, type ValueStore } from '@/lib/value-store';
import type { DocumentEditing, ReplicaKeeper } from './use-docs-document';

export type { ChatDocumentOrigin } from '@/lib/cdoc/chat/chat-replica-keeper';
export type { ChatPeer } from '@/lib/cdoc/chat/chat-app-ports';

export const CHAT_PICTURES_UNAVAILABLE: string = 'Pictures cannot be added to a chat document yet: the other person would see an empty box where the picture is.';

export interface ChatDocumentRequest {
  /** The id the chat message named the document by. */
  readonly docId: string;
  /** The local account: whose copy this device keeps, and who renames sign as. */
  readonly selfCid: bigint;
  /** The title the chat message gave it, shown until a rename (either person's) is heard. */
  readonly title: string;
  /** What it opens from when this device keeps no copy yet: blank, the creator's typed text, or a migration's snapshot. */
  readonly origin: ChatDocumentOrigin;
  /** The peer's copy was moved from another original (`theirs`): the two are held apart, and this is said. */
  readonly heldApart: (theirs: string | null) => void;
}

export interface ChatDocument {
  /** DocumentHost's `editing`; one per open document (memoise it on docId). */
  readonly editing: DocumentEditing;
  /** The document's title as it stands: the chat's, until a rename wins. */
  readonly title: ValueStore<string>;
  /**
   * Renames it for everyone it is shared with; rejects while it is not open, or for a title that
   * is not one. Null where nothing carries a rename, so no rename control is offered.
   */
  readonly rename: ((title: string) => Promise<void>) | null;
}

/** A document of the 1:1 chat with `peer`. */
export function openChatDocument(peer: ChatPeer, request: ChatDocumentRequest): ChatDocument {
  const title: ValueStore<string> = createValueStore<string>(`chat-document-title:${request.docId}`, request.title);
  let bound: ChatDocumentSync | null = null;
  const keep: ReplicaKeeper = (open, show, fail): (() => Promise<void>) => {
    let live: boolean = true;
    let release: (() => Promise<void>) | null = null;
    Promise.all([import('@/lib/cdoc/chat/chat-replica-keeper'), import('@/lib/cdoc/chat/chat-app-ports'), import('@/lib/cdoc/chat/chat-config'), import('@/lib/cdoc/chat/chat-problems')]).then(
      ([{ chatReplicaKeeper }, { chatKeeperPorts }, { CHAT_SYNC }, { ChatSyncError }]): void => {
        if (!live) return;
        // One notice per document and kind of problem: a repeat updates it instead of stacking.
        const report = (problem: ChatSyncProblem): void => { toast.error(new ChatSyncError(problem).message, { id: `chat-document:${request.docId}:${problem.kind}` }); };
        release = chatReplicaKeeper<EditorSession>(request.docId, request.origin, CHAT_SYNC, chatKeeperPorts(request.selfCid, peer), {
          report,
          titled: (stamp: CdocChatTitleStamp): void => title.set(stamp.title),
          bound: (sync: ChatDocumentSync | null): void => { bound = sync; },
          heldApart: request.heldApart,
        })(open, show, fail);
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
    editing: { kind: 'replica', keep, save: null, pictures: CHAT_PICTURES_UNAVAILABLE },
    title,
    rename: async (next: string): Promise<void> => {
      if (bound === null) throw new Error('The document is not open.');
      bound.rename(next);
    },
  };
}
