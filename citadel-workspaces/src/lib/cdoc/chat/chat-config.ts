/**
 * How a chat document is kept in step between the two peers of a 1:1 chat. Every setting is
 * required (PCND); CHAT_SYNC is the one production configuration, each value with its reason.
 */
import type { PresenceSettings } from '../collab/document-presence';
import { CDOC_CRDT_DOC_VERSION } from '../collab/relay-limits';

export interface ChatSyncConfig {
  /** The CRDT wire format written and accepted (cdoc-crdt's VERSION byte); any other is refused. */
  readonly docVersion: number;
  /** The most bytes one encoded CdocChatSync command may take on the wire. */
  readonly maxMessageBytes: number;
  /** The most CRDT bytes one `diff` chunk carries: the message bound less the envelope's headroom. */
  readonly maxChunkBytes: number;
  /** Local updates made within this window leave as one `update` message. */
  readonly updateCoalesceMs: number;
  /** After an applied update left operations waiting, a hello asks for what is missing this much later. */
  readonly askAfterMs: number;
  /** How long the replica stays still before its pending updates are written to this device. */
  readonly storeAfterIdleMs: number;
  /** Past this many pending updates, a write folds them into a new snapshot. */
  readonly foldAfterUpdates: number;
  /**
   * While a document is closed, the most updates arriving for it that are recorded on this
   * device (they cannot be folded without a replica); past it they are left to the next hello.
   */
  readonly closedMaxPending: number;
  /** v1 never collects tombstones: an offline peer's unsent edits are invisible to us. */
  readonly gcBeforeSnapshot: 'never';
  readonly presence: PresenceSettings;
}

/** What a command's envelope (type, doc id, version, kind, indices) takes beyond its CRDT bytes, generously. */
export const ENVELOPE_HEADROOM_BYTES: number = 1024;

/** A CBOR byte string's header is at most 9 bytes; each update in an `update` message pays one. */
export const PER_UPDATE_OVERHEAD_BYTES: number = 9;

// The agent's socket carries the CBOR as a JSON number array, about 3.5 bytes per byte, so one
// 64 KiB command is ~230 KB of JSON: small enough that a reconnect's diff never holds the
// socket long, and the same bound the workspace relay puts on one update.
const MAX_MESSAGE_BYTES: number = 64 * 1024;

export const CHAT_SYNC: ChatSyncConfig = {
  docVersion: CDOC_CRDT_DOC_VERSION,
  maxMessageBytes: MAX_MESSAGE_BYTES,
  maxChunkBytes: MAX_MESSAGE_BYTES - ENVELOPE_HEADROOM_BYTES,
  // The Yjs provider's window (yjs-p2p-provider/constants.ts): one message per keystroke is a
  // frame per keystroke through both agents, and 300 ms is well inside what a co-editor notices.
  updateCoalesceMs: 300,
  // Long enough for the rest of a reordered burst to arrive and fill the gap by itself.
  askAfterMs: 1_000,
  // A pause in typing, as the workspace session's base copy (replica-keeper.ts baseAfterIdleMs).
  storeAfterIdleMs: 2_000,
  // A few minutes of typing: a reopen applies at most this many updates over its snapshot.
  foldAfterUpdates: 200,
  // Ten folds' worth: a reopen applies them all before it shows the document.
  closedMaxPending: 2_000,
  gcBeforeSnapshot: 'never',
  presence: {
    // Two a second: the caret keeps up with typing at fewer frames than the edits themselves.
    awarenessPerSecond: 2,
    maxAwarenessBytes: 4_096,
    // Three heartbeats per expiry: one lost record does not make a present peer vanish.
    awarenessHeartbeatMs: 5_000,
    peerExpiryMs: 15_000,
    // One caret per tab of the peer's account.
    maxCaretsPerSession: 8,
  },
};
