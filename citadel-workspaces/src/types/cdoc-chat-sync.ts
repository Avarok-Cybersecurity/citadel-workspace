/**
 * The wire shape of `P2PCommandType.CdocChatSync`: a Citadel Docs document kept in step
 * between the two people of a 1:1 chat, peer to peer, with no workspace server involved.
 * Only the shape lives here, so the message handler can recognise it and hand it on as the
 * `cdoc:chat-command` event without loading cdoc; reading each kind (lib/cdoc/chat/chat-wire.ts)
 * and acting on it are lazy. Bytes are CBOR byte strings and CIDs bigints (cbor-x keeps both).
 */

/** The event the message handler emits for every CdocChatSync command it receives. */
export const CDOC_CHAT_COMMAND_EVENT: 'cdoc:chat-command' = 'cdoc:chat-command';

/** A title as last set, by whom and when: the later wins, the higher cid on a tie (LWW). */
export interface CdocChatTitleStamp {
  readonly title: string;
  /** Wall-clock milliseconds when it was set. */
  readonly at: number;
  readonly by: bigint;
}

export type CdocChatSync =
  /**
   * Sent on open and on every (re)connect. The receiver answers with a `diff` against
   * `state_vector`, and, when `answer` is false, with a hello of its own (`answer: true`).
   */
  | {
      readonly kind: 'hello';
      readonly state_vector: Uint8Array;
      readonly answer: boolean;
      readonly title: CdocChatTitleStamp | null;
    }
  /** One chunk of the answer to a hello, a valid update on its own: `index` of `count`. */
  | { readonly kind: 'diff'; readonly chunk: Uint8Array; readonly index: number; readonly count: number }
  /** Local edits, in the order they were made. */
  | { readonly kind: 'update'; readonly updates: readonly Uint8Array[] }
  /** The sender's awareness record (caret and selection). */
  | { readonly kind: 'awareness'; readonly record: Uint8Array }
  | { readonly kind: 'rename'; readonly title: CdocChatTitleStamp };

export type CdocChatSyncKind = CdocChatSync['kind'];

/**
 * A document's pictures between the two peers, by content id (`sha256-<hex>`): the document
 * names a picture, these carry its bytes (lib/cdoc/pictures/pair-pictures.ts). Not CRDT
 * traffic: a document's sync never reads them, and they are checked where they are read
 * (lib/cdoc/chat/picture-wire.ts).
 */
export type CdocChatPictureSync =
  /** The sender now keeps this picture of the document: the receiver may want it. */
  | { readonly kind: 'picture_have'; readonly content_id: string }
  /** Asks for the bytes, answered with every `picture_chunk` or one `picture_none`. */
  | { readonly kind: 'picture_want'; readonly content_id: string }
  /** Chunk `index` of `count` of a picture of `size` bytes. */
  | { readonly kind: 'picture_chunk'; readonly content_id: string; readonly index: number; readonly count: number; readonly size: number; readonly chunk: Uint8Array }
  /** The sender does not give this picture of the document (it keeps none, or the document is not shared with the asker). */
  | { readonly kind: 'picture_none'; readonly content_id: string };

export type CdocChatPictureSyncKind = CdocChatPictureSync['kind'];

export interface CdocChatSyncPayload {
  readonly doc_id: string;
  /** The CRDT wire format the sender writes (cdoc-crdt's VERSION byte); a mismatch is refused. */
  readonly doc_version: number;
  readonly sync: CdocChatSync | CdocChatPictureSync;
}

/** What `cdoc:chat-command` carries: who sent it, the session it is addressed to, and the payload. */
export interface CdocChatCommandEvent {
  readonly peerCid: bigint;
  /** The notification's recipient session; absent on the legacy PeerMessage path. */
  readonly recipient_cid: bigint | undefined;
  readonly payload: CdocChatSyncPayload;
}

const PICTURE_KINDS: readonly string[] = ['picture_have', 'picture_want', 'picture_chunk', 'picture_none'] satisfies readonly CdocChatPictureSyncKind[];
const KINDS: readonly string[] = [...(['hello', 'diff', 'update', 'awareness', 'rename'] satisfies readonly CdocChatSyncKind[]), ...PICTURE_KINDS];

/** Whether `sync` carries a picture rather than the document's CRDT state. */
export function isPictureSync(sync: CdocChatSyncPayload['sync']): sync is CdocChatPictureSync {
  return PICTURE_KINDS.includes(sync.kind);
}

/** The envelope only: each kind's fields are checked where they are read (lib/cdoc/chat/chat-wire.ts). */
export function isCdocChatSyncPayload(payload: unknown): payload is CdocChatSyncPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const p: Record<string, unknown> = payload as Record<string, unknown>;
  if (typeof p.doc_id !== 'string' || typeof p.doc_version !== 'number') return false;
  const sync: unknown = p.sync;
  if (typeof sync !== 'object' || sync === null) return false;
  const kind: unknown = (sync as Record<string, unknown>).kind;
  return typeof kind === 'string' && KINDS.includes(kind);
}
