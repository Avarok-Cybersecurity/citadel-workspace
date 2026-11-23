/**
 * The scratchpad's transport: the account's conversation with itself, over the same pane and the
 * same messenger as a direct chat (lib/scratchpad/self-conversation.ts).
 *
 * Its notes are the messenger's messages with the account's own cid as the peer, so writing,
 * editing, deleting, reacting and retrying are the direct chat's send port unchanged; the agent
 * stores them and sends none of it. What a direct chat has because someone is at the other end is
 * absent here: no status port (presence, typing, connection), no settings, no delivery ticks.
 * Files are kept on this device (scratchpad-blobs.ts); documents are kept live with nobody.
 */
import type { P2PMessengerManager } from '@/lib/p2p/p2p-messenger-manager';
import type { P2PMessage } from '@/lib/p2p/p2p-types';
import type { ChatPeer } from '@/lib/cdoc/chat/chat-app-ports';
import type { OpeningPorts } from '@/components/p2p/chat-document/chat-document-opening';
import type { GroupRestriction } from '@/components/chat/group-restriction';
import { declaredMime, type SharedFile } from '@/lib/chat/attachments/shared-file';
import { createValueStore, type ValueStore } from '@/lib/value-store';
import type { ScratchpadBlobs } from '@/lib/scratchpad/scratchpad-blobs';
import { SCRATCHPAD_DOCUMENTS, SCRATCHPAD_FILES, SCRATCHPAD_LINE, SCRATCHPAD_TITLE } from '@/lib/scratchpad/self-conversation';
import { chatFeatures } from './features';
import { peerHistory } from './peer-history';
import { peerSend } from './peer-transport';
import type { ChatMessage, ChatSelf, ChatTransport, DocumentInvitation, DocumentPort, FileOpening, FilePort, FileSendReceipt, HistoryEvent, HistoryPage, HistoryPort } from './chat-transport';

const NO_OFFERS: string = 'A scratchpad file is kept on this device, so there is no offer to answer.';

/** The file a note keeps, as its card shows it; absent for a note without one. */
function noteFile(message: Pick<P2PMessage, 'attachments'>): SharedFile | undefined {
  const kept: NonNullable<P2PMessage['attachments']>[number] | undefined = message.attachments?.[0];
  return kept === undefined ? undefined : { id: kept.file_id, name: kept.file_name, size: kept.file_size, mime: kept.file_type };
}

const withFile = (m: ChatMessage): ChatMessage => {
  const attachment: SharedFile | undefined = noteFile(m);
  return attachment === undefined ? m : { ...m, attachment };
};

/** The direct chat's history, with each note's kept file named for its card. */
export function notesHistory(history: HistoryPort): HistoryPort {
  const page = (p: HistoryPage): HistoryPage => ({ ...p, messages: p.messages.map(withFile) });
  const event = (e: HistoryEvent): HistoryEvent => {
    switch (e.kind) {
      case 'arrived': case 'recorded': case 'replaced': return { ...e, message: withFile(e.message) };
      default: return e;
    }
  };
  return {
    ...history,
    loadLatest: async (): Promise<HistoryPage> => page(await history.loadLatest()),
    loadOlder: async (cursor): Promise<HistoryPage> => page(await history.loadOlder(cursor)),
    cached: (): readonly ChatMessage[] => history.cached().map(withFile),
    subscribe: (listener: (e: HistoryEvent) => void): (() => void) => history.subscribe((e: HistoryEvent): void => listener(event(e))),
  };
}

/** Writes a note to the account's own conversation (the messenger, with the account as the peer). */
export type WriteNote = (content: string, attachment: SharedFile) => Promise<void>;

export type ReadFile = (file: File) => Promise<Uint8Array>;

export function notesFiles(blobs: ScratchpadBlobs, readFile: ReadFile, write: WriteNote): FilePort {
  const refuse = (): Promise<void> => Promise.reject(new Error(NO_OFFERS));
  return {
    modes: ['device'],
    destination: SCRATCHPAD_FILES,
    dialogKey: null,
    send: async (file: File): Promise<FileSendReceipt> => {
      const bytes: Uint8Array = await readFile(file);
      const id: string = await blobs.keep(bytes);
      await write(file.name, { id, name: file.name, size: bytes.length, mime: declaredMime(file.type) });
      return { outcome: 'kept' };
    },
    accept: refuse,
    decline: refuse,
    cancel: refuse,
    open: async (): Promise<FileOpening> => ({ kind: 'unknown' }),
    read: (shared: SharedFile): Promise<Uint8Array> => blobs.read(shared.id),
  };
}

function notesDocuments(messenger: P2PMessengerManager, self: ChatPeer, opening: OpeningPorts): DocumentPort {
  return {
    sharedWith: SCRATCHPAD_DOCUMENTS,
    opening,
    invite: async ({ docId, title, onRecorded }: DocumentInvitation): Promise<void> => {
      await messenger.sendMessage(self.cid, `Created live document: ${title}`, {
        messageType: 'live_document', documentId: docId, documentTitle: title, onOptimisticAppend: onRecorded,
      });
    },
    // Nobody else edits a scratchpad document, so nothing lights its tab.
    onActivity: (): (() => void) => (): void => undefined,
  };
}

export interface ScratchpadTransportParams {
  readonly messenger: P2PMessengerManager;
  readonly self: ChatSelf;
  readonly opening: OpeningPorts;
  readonly blobs: ScratchpadBlobs;
  /** A picked file's bytes (node-chat-io's `readBrowserFile` in the app). */
  readonly readFile: ReadFile;
  /** 'allowed', or 'needs-agent-update' while the agent cannot keep notes unsent. */
  readonly sendGate: ValueStore<GroupRestriction>;
}

export function createScratchpadTransport({ messenger, self, opening, blobs, readFile, sendGate }: ScratchpadTransportParams): ChatTransport {
  const own: ChatPeer = { cid: self.cid, name: SCRATCHPAD_TITLE, username: self.username };
  const write: WriteNote = async (content: string, file: SharedFile): Promise<void> => {
    await messenger.sendMessage(self.cid, content, {
      messageType: 'text', attachments: [{ file_id: file.id, file_name: file.name, file_size: file.size, file_type: file.mime }],
    });
  };
  const ports: Pick<ChatTransport, 'send' | 'status' | 'files' | 'documents' | 'settings'> = {
    send: peerSend(messenger, own),
    status: null,
    files: notesFiles(blobs, readFile, write),
    documents: notesDocuments(messenger, own, opening),
    settings: null,
  };
  return {
    kind: 'scratchpad',
    conversationKey: `scratchpad:${self.cid.toString()}`,
    self,
    counterpart: { name: SCRATCHPAD_TITLE, username: null, greeting: SCRATCHPAD_LINE, emptyHeading: null },
    features: chatFeatures(ports, {
      markdown: true, readReceipts: false, securityLevel: false, retention: false, optimistic: true, namesSenders: false, deliveryTicks: false,
    }),
    sendGate,
    history: notesHistory(peerHistory(messenger, own, self)),
    ...ports,
    reactorName: (): string => 'You',
  };
}

/** The gate a scratchpad starts with: open, until the agent says whether it keeps notes unsent. */
export function scratchpadGate(account: bigint): ValueStore<GroupRestriction> {
  return createValueStore<GroupRestriction>(`scratchpad-gate:${account.toString()}`, 'allowed');
}
