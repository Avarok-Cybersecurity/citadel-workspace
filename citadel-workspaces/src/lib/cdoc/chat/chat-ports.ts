/**
 * The I/O a chat document does, each behind a port, so its sync and storage are pure ordering
 * logic: the P2P channel to the one peer, time, and this device's copy in the agent's LocalDB.
 */
import type { CdocChatSyncPayload, CdocChatTitleStamp } from '@/types/cdoc-chat-sync';

/** The P2P channel between this session and the chat's peer, for one account. */
export interface ChatTransport {
  /** The local account: what this side signs titles with and stores its copy under. */
  readonly selfCid: bigint;
  readonly peerCid: bigint;
  /** Hands an encoded command (chat-wire.ts encodeChatSync) to the channel; resolves once it has left. */
  send(bytes: Uint8Array): Promise<void>;
  /** Every CdocChatSync payload the peer sends this account, for any document. */
  onMessage(listener: (payload: CdocChatSyncPayload) => void): () => void;
  /** The channel to the peer was established, or re-established after a drop. */
  onConnected(listener: () => void): () => void;
}

/** Wall-clock milliseconds, for title stamps compared across devices (never performance.now). */
export type WallClock = () => number;

/** A stored snapshot: what a reopen starts from. */
export interface StoredBase {
  readonly docVersion: number;
  readonly snapshot: Uint8Array;
  /** What the document was migrated from, carried in every hello; null when it was not. */
  readonly migrationOrigin: string | null;
}

/** The index's entry for a chat document: whose chat it is in, and its title. */
export interface ChatIndexEntry {
  readonly peerCid: bigint;
  readonly title: CdocChatTitleStamp | null;
  /** Held apart from the peer's copy (chat-migration-gate.ts): nothing of theirs is applied or recorded. */
  readonly heldApart: boolean;
}

/**
 * This account's copies of its chat documents on this device. Every implementation keeps them
 * under the local account and no other (never the device-wide cid 0), so another account
 * signed in to the same agent cannot read them. A record that is there but malformed throws.
 */
export interface ChatStoreBackend {
  loadBase(docId: string): Promise<StoredBase | null>;
  saveBase(docId: string, base: StoredBase): Promise<void>;
  /** The updates applied since the stored base, in order; empty when none. */
  loadPending(docId: string): Promise<readonly Uint8Array[]>;
  savePending(docId: string, updates: readonly Uint8Array[]): Promise<void>;
  loadEntry(docId: string): Promise<ChatIndexEntry | null>;
  saveEntry(docId: string, entry: ChatIndexEntry): Promise<void>;
}
