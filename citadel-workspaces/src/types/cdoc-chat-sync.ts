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
      /** What the document was migrated from, when it was (null: created in Citadel Docs). */
      readonly migration_origin: string | null;
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

export interface CdocChatSyncPayload {
  readonly doc_id: string;
  /** The CRDT wire format the sender writes (cdoc-crdt's VERSION byte); a mismatch is refused. */
  readonly doc_version: number;
  readonly sync: CdocChatSync;
}

/** What `cdoc:chat-command` carries: who sent it, the session it is addressed to, and the payload. */
export interface CdocChatCommandEvent {
  readonly peerCid: bigint;
  /** The notification's recipient session; absent on the legacy PeerMessage path. */
  readonly recipientCid: bigint | undefined;
  readonly payload: CdocChatSyncPayload;
}

const KINDS: readonly string[] = ['hello', 'diff', 'update', 'awareness', 'rename'] satisfies readonly CdocChatSyncKind[];

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
