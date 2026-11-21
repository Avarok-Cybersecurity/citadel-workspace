/**
 * What a chat's document tab opens, decided from the document's id (lib/p2p/chat-document-id.ts):
 * a Citadel Docs document opens as a live canvas kept in step with the peer; one made in the
 * earlier chat editor is not opened, and the tab says so. Nothing here is silent: a part that
 * did not load is a notice with its reason, never "no document".
 *
 * Its I/O arrives as a port (the canvas's opener, loaded on first use).
 */
import type { ChatDocument, ChatDocumentRequest } from '@/components/documents/chat-replica';
import { chatDocumentFormat } from '@/lib/p2p/chat-document-id';
import type { UnopenedReason } from './chat-document-copy';

export interface ChatDocumentTarget {
  readonly docId: string;
  /** The title the chat message gave it. */
  readonly title: string;
  readonly selfCid: bigint;
  /** The creator's typed text, for a document made in this chat just now; null otherwise. */
  readonly seed: string | null;
}

export type ChatDocumentOpening =
  | { readonly kind: 'canvas'; readonly document: ChatDocument }
  | { readonly kind: 'unopened'; readonly reason: UnopenedReason };

/** Opens a document of one conversation: who it is kept live with is the opener's, not the request's. */
export type ChatDocumentOpener = (request: ChatDocumentRequest) => ChatDocument;

export interface OpeningPorts {
  readonly opener: () => Promise<ChatDocumentOpener>;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function openCdoc(target: ChatDocumentTarget, ports: OpeningPorts): Promise<ChatDocumentOpening> {
  const open: ChatDocumentOpener = await ports.opener();
  const document: ChatDocument = open({
    docId: target.docId, selfCid: target.selfCid, title: target.title,
    origin: target.seed === null ? { kind: 'blank' } : { kind: 'seeded', text: target.seed },
  });
  return { kind: 'canvas', document };
}

/** Never rejects: a part that did not load is an opening that says so. */
export function openChatDocumentTab(target: ChatDocumentTarget, ports: OpeningPorts): Promise<ChatDocumentOpening> {
  if (chatDocumentFormat(target.docId) !== 'cdoc') return Promise.resolve({ kind: 'unopened', reason: { kind: 'earlier-editor' } });
  return openCdoc(target, ports).catch((error: unknown): ChatDocumentOpening => ({ kind: 'unopened', reason: { kind: 'load-failed', message: messageOf(error) } }));
}
