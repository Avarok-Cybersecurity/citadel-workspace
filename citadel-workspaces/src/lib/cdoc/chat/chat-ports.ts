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

/**
 * What a stored snapshot holds beyond `stateVector`, as one update: read by a replica opened over
 * the snapshot in a runtime of its own. A cdoc runtime holds one editor, so a replica opened in
 * the shown document's runtime would replace the shown replica there.
 */
export type SnapshotDiff = (snapshot: Uint8Array, stateVector: Uint8Array) => Promise<Uint8Array>;

/** Wall-clock milliseconds, for title stamps compared across devices (never performance.now). */
export type WallClock = () => number;

/** A stored snapshot: what a reopen starts from. */
export interface StoredBase {
  readonly docVersion: number;
  readonly snapshot: Uint8Array;
}

/** The index's entry for a chat document: whose chat it is in, and its title. */
export interface ChatIndexEntry {
  readonly peerCid: bigint;
  readonly title: CdocChatTitleStamp | null;
}

/** This browser's windows (tabs), which share one agent and so one account's copies. */
export interface ChatTabs {
  /** Runs `step` while no other step under `name` runs in any window of this browser; waits its turn. */
  exclusive<T>(name: string, step: () => Promise<T>): Promise<T>;
  /** Tells this window's other listeners and every other window that `account`'s copy of `docId` was written. */
  wrote(account: bigint, docId: string, writer: object): void;
  /** Every such announcement for `account`; `writer` is null when it came from another window. */
  onWrote(account: bigint, listener: (docId: string, writer: object | null) => void): () => void;
}

/**
 * This account's copies of its chat documents on this device. Every implementation keeps them
 * under the local account and no other (never the device-wide cid 0), so another account
 * signed in to the same agent cannot read them. A record that is there but malformed throws.
 */
export interface ChatStoreBackend {
  /**
   * Runs `step` while no other step for `docId`'s copy runs in any window of this browser (they
   * share the agent's LocalDB, which has no compare-and-set): a read-modify-write inside it
   * cannot lose another window's write. Not reentrant: `step` must not ask for it again.
   */
  exclusive<T>(docId: string, step: () => Promise<T>): Promise<T>;
  /** Tells every other holder of the copy, in this window and the browser's others, that `writer` wrote it. */
  wrote(docId: string, writer: object): void;
  /** A copy was written: its docId, and the writer when it is in this window (null from another window). */
  onWrote(listener: (docId: string, writer: object | null) => void): () => void;
  loadBase(docId: string): Promise<StoredBase | null>;
  saveBase(docId: string, base: StoredBase): Promise<void>;
  /** The updates applied since the stored base, in order; empty when none. */
  loadPending(docId: string): Promise<readonly Uint8Array[]>;
  savePending(docId: string, updates: readonly Uint8Array[]): Promise<void>;
  loadEntry(docId: string): Promise<ChatIndexEntry | null>;
  saveEntry(docId: string, entry: ChatIndexEntry): Promise<void>;
}
