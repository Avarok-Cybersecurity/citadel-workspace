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
import type { FileDetails } from '@/components/layout/sidebar/file-details';
import type { ChatFeatures } from './features';
import type { GroupRestriction } from '@/components/chat/group-restriction';
import type { ValueStore } from '@/lib/value-store';
import type { GroupFileShare } from '@/types/group-file-share';
import type { SharedFile } from '@/lib/chat/attachments/shared-file';
import type { ReadReceipt } from './read-receipts';

export type ChatKind = 'peer' | 'node' | 'peer-group';

export interface ChatSelf {
  readonly cid: bigint;
  readonly username: string;
  readonly displayName: string;
}

/** Who the conversation is with: one peer, or a channel's readers. */
export interface ChatCounterpart {
  /** What the pane calls them in a sentence ("Say hello to …", "Shared live with …"). */
  readonly name: string;
  /** The roster key behind a single peer's picture; null for a channel. */
  readonly username: string | null;
  /** The empty transcript's sentence: who to greet, and how the messages travel. */
  readonly greeting: string;
}

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
export type PaneMessage = Omit<P2PMessage, 'senderCid' | 'recipientCid'> & Partial<Pick<P2PMessage, 'senderCid' | 'recipientCid'>> & {
  /** Who of a channel's members has seen the reader's own message; absent in a two-party chat. */
  readonly receipt?: ReadReceipt;
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
  readonly replyTo: string | null;
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
  /** Sends what was held until they accepted. */
  flushHeld(): void;
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

/** How a file can leave: to the peer directly (and their storage), to each member directly, or into the server's file store. */
export type FileMode = 'peer' | 'their-storage' | 'members' | 'server';

export interface FileSendReceipt {
  /**
   * `held`: kept until the counterpart is online. `offered`: on its way to be offered, which its
   * bubble follows. `shared`: already stored where the conversation keeps files, and shared.
   */
  readonly outcome: 'held' | 'offered' | 'shared';
}

/** How many of a file's bytes have reached where they are kept, as that place acknowledges them. */
export type SendProgress = (doneBytes: number, totalBytes: number) => void;

/** What opening a received file came to. 'unknown': this device has no record of the file. */
export type FileOpening =
  | { readonly kind: 'downloaded' }
  | { readonly kind: 'unreadable'; readonly reason: string; readonly details: FileDetails }
  | { readonly kind: 'unknown' };

export interface FilePort {
  readonly modes: readonly FileMode[];
  /** Said beside the attach control: where the file goes, and who can read it. */
  readonly destination: string;
  /**
   * `onProgress` hears a send the conversation shows no bubble for (a file the server keeps); a
   * transfer that has a bubble reports its progress there and does not call it.
   */
  send(file: File, onProgress: SendProgress): Promise<FileSendReceipt>;
  accept(transferId: string): Promise<void>;
  decline(transferId: string): Promise<void>;
  cancel(transferId: string): Promise<void>;
  /** The bytes of a file a message shares, read from where the conversation keeps it; null where files are offered, not kept. */
  readonly read: ((file: SharedFile) => Promise<Uint8Array>) | null;
  /**
   * Opens a received file: the browser downloads the original, or, when its bytes cannot be had,
   * the conversation is told why and what is known of it.
   */
  open(transferId: string): Promise<FileOpening>;
  /**
   * The one peer the send dialog's own paths (native picker, their storage) address; null in a
   * conversation of many, where the paperclip opens the browser's file picker straight away.
   */
  readonly dialogKey: string | null;
}

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
