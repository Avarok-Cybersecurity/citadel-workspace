/**
 * The one seam between a chat pane and whatever carries its conversation.
 *
 * A direct chat, a node channel and a peer group used to be two components with two state
 * machines, so every feature the direct chat gained (live documents, files, ticks, retry,
 * drafts) was missing from the node chat until someone ported it by hand, and mostly nobody
 * did. Here a conversation is a set of ports; the pane is written once against them, and an
 * adapter per transport says what each port does. A port that is null is a thing this
 * conversation cannot do, and `features` (features.ts) is derived from the ports, never passed
 * beside them, so the two cannot disagree.
 */
import type { P2PMessage, PeerPresence } from '@/lib/p2p/p2p-types';
import type { MessageStatus } from 'citadel-internal-service-wasm-client';
import type { MessageType } from '@/types/message-protocol';
import type { OpeningPorts } from '@/components/p2p/chat-document/chat-document-opening';
import type { ChatFeatures } from './features';
import type { GroupRestriction } from '@/components/chat/group-restriction';
import type { ValueStore } from '@/lib/value-store';
import type { GroupFileShare } from '@/types/group-file-share';
import type { SharedFile } from '@/lib/chat/attachments/shared-file';
import type { ReadReceipt } from './read-receipts';

export type ChatKind = 'peer' | 'node' | 'peer-group' | 'scratchpad';

export interface ChatSelf {
  readonly cid: bigint;
  readonly username: string;
  readonly displayName: string;
}

import type { ChatCounterpart } from './chat-counterpart';
export type { ChatCounterpart };

/** Who wrote one message, decided by the adapter that knows the transport's identities. */
export interface ChatAuthor {
  readonly own: boolean;
  readonly name: string;
  /** The roster key for the picture; null for the reader's own messages. */
  readonly username: string | null;
}

/**
 * A message as the pane renders it. The CIDs are a direct chat's: a channel names its senders by
 * username and has no recipient, so there they are absent rather than invented.
 */
export type PaneMessage = Omit<P2PMessage, 'sender_cid' | 'recipient_cid'> & Partial<Pick<P2PMessage, 'sender_cid' | 'recipient_cid'>> & {
  /** Who of a channel's members has seen the reader's own message; absent in a two-party chat. */
  readonly receipt?: ReadReceipt;
  /** What the server said became of the reader's own peer-group message (group-send-outcome). */
  readonly sendNote?: { readonly text: string; readonly failed: boolean };
};

export type ChatMessage = PaneMessage & {
  readonly author: ChatAuthor;
  /** A file shared into a peer group, with who has it; null for every other message. */
  readonly share: GroupFileShare | null;
  /** A file a node channel keeps on the server, which the message shares; absent for every other message. */
  readonly attachment?: SharedFile;
};

/** Where older history continues from. Opaque to the pane: only its adapter reads it. */
export type HistoryCursor =
  | { readonly kind: 'page'; readonly page: number }
  | { readonly kind: 'before'; readonly timestamp: bigint };

export interface HistoryPage {
  readonly messages: readonly ChatMessage[];
  readonly older: HistoryCursor | null;
}

export type HistoryEvent =
  /** `incoming`: written by someone else, so it can be unread. */
  | { readonly kind: 'arrived'; readonly message: ChatMessage; readonly incoming: boolean }
  /** Put in the transcript by another part of the app (a file transfer); shown, never announced. */
  | { readonly kind: 'recorded'; readonly message: ChatMessage }
  | { readonly kind: 'status'; readonly messageId: string; readonly status: MessageStatus }
  | { readonly kind: 'updated'; readonly message: Partial<ChatMessage> & { readonly id: string } }
  | { readonly kind: 'removed'; readonly messageId: string }
  /** The transport's own copy of a message the reader sent replaces the one shown while it was sent. */
  | { readonly kind: 'replaced'; readonly localId: string; readonly message: ChatMessage }
  | { readonly kind: 'cleared' }
  /** Retention dropped everything older than `cutoff` (ms). */
  | { readonly kind: 'expired'; readonly cutoff: number };

export interface HistoryPort {
  /** The newest stored history, read once the transport is ready. */
  loadLatest(): Promise<HistoryPage>;
  loadOlder(cursor: HistoryCursor): Promise<HistoryPage>;
  /** What the transport already holds in memory, for arrivals the load raced. */
  cached(): readonly ChatMessage[];
  subscribe(listener: (event: HistoryEvent) => void): () => void;
  /** Marks the given messages read, or every unread one when `messageIds` is null. */
  markRead(messageIds: readonly string[] | null): Promise<void>;
  /** This window has the conversation in front; returns the release. */
  focus(): () => void;
  /** The reader is looking at the messages: this conversation's notifications are read. */
  clearNotices(): void;
}

export interface TextSend {
  readonly content: string;
  readonly messageType: Extract<MessageType, 'text' | 'markdown'>;
  readonly reply_to: string | null;
  /** Fired once the message is in the transcript, where a later failure can be retried. */
  readonly onRecorded: () => void;
}

/** Changing a message after it was sent. */
export interface RevisePort {
  edit(messageId: string, content: string): Promise<void>;
  remove(messageId: string): Promise<void>;
}

export interface SendPort {
  text(message: TextSend): Promise<void>;
  /** Null where the wire carries no edit or delete (a peer group). */
  readonly revise: RevisePort | null;
  /** Toggles the reader's own `emoji` on a message; null where the transport carries no reactions. */
  readonly react: ((messageId: string, emoji: string) => Promise<void>) | null;
  retry(messageId: string): Promise<void>;
}

export interface StatusSnapshot {
  readonly connected: boolean;
  readonly presence: PeerPresence | null;
  /** Names of whoever is typing now. */
  readonly typing: readonly string[];
}

export type StatusChange =
  | { readonly kind: 'connected'; readonly connected: boolean }
  | { readonly kind: 'presence'; readonly presence: PeerPresence }
  | { readonly kind: 'typing'; readonly typing: readonly string[] };

/** A counterpart who has to accept before messages leave (a P2P registration). */
export interface AcceptancePort {
  accepted(): boolean;
  onAccepted(listener: () => void): () => void;
}

/** What only an asynchronous question answers; `presence` is null when it brought no news. */
export interface StatusProbe {
  readonly connected: boolean;
  readonly presence: PeerPresence | null;
}

export interface StatusPort {
  /** Read now; `probe` asks what can only be learnt asynchronously. */
  snapshot(): StatusSnapshot;
  probe(): Promise<StatusProbe>;
  subscribe(listener: (change: StatusChange) => void): () => void;
  /** Reports the reader's typing while the composer has focus; `currentText` is read on each tick. */
  startTyping(currentText: () => string): void;
  stopTyping(): void;
  readonly acceptance: AcceptancePort | null;
}

export type { FileMode, FileSendReceipt, SendProgress, FileOpening, FilePort } from './file-port';
import type { FilePort } from './file-port';

export interface DocumentInvitation {
  readonly docId: string;
  readonly title: string;
  readonly onRecorded: () => void;
}

export interface DocumentPort {
  /** Said above an open document: who it is kept live with ("Shared live with Bob"). */
  readonly sharedWith: string;
  readonly opening: OpeningPorts;
  /** Posts the message that names a new document. */
  invite(invitation: DocumentInvitation): Promise<void>;
  /** Fires with a document's id when someone else changes what it shows. */
  onActivity(listener: (docId: string) => void): () => void;
}

export interface SettingsPort {
  /** The peer cid, as a string, that the per-chat settings (security level, retention, stats) are stored under. */
  readonly key: string;
}

export interface ChatTransport {
  readonly kind: ChatKind;
  /** Drafts and remembered state are keyed by it; unique across kinds. */
  readonly conversationKey: string;
  readonly self: ChatSelf | null;
  readonly counterpart: ChatCounterpart;
  readonly features: ChatFeatures;
  /** Whether the reader may send now; live, because a role can change while the chat is open. */
  readonly sendGate: ValueStore<GroupRestriction>;
  readonly history: HistoryPort;
  readonly send: SendPort;
  readonly status: StatusPort | null;
  readonly files: FilePort | null;
  readonly documents: DocumentPort | null;
  readonly settings: SettingsPort | null;
  /** A reactor's name, by the cid the transport says reacted; the reader is "You". */
  reactorName(cid: bigint): string;
}
