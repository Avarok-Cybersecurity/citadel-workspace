/**
 * Where a document's pictures are kept: the one port every backend implements (the workspace
 * server for pages and node-chat documents, the P2P pair for a direct chat's documents, this
 * device for the scratchpad's). The editor holds a picture's bytes only while a document is open
 * (cdoc-edit's ImageLibrary); the document itself names each picture by its content id, so the
 * bytes are stored here under that id and fetched back by it.
 *
 * Frozen contract (REL-1124 §3, "Document picture store"): a content id is `sha256-` and the
 * lowercase hex SHA-256 of the bytes; the only keys are the document's address and the content
 * id; every read is verified against the id before the bytes reach the editor (DocumentPictures
 * does that, never a backend). A later release re-points the storage at a volume's blob store
 * without changing the id, by implementing this port again.
 */

/** Which document a picture belongs to. Its own read and write gates guard the picture. */
export type PictureDocument =
  /** A workspace node's page: read needs ViewContent, write EditMdx, on the node. */
  | { readonly kind: 'page'; readonly nodeId: string }
  /** A document shared in a node's chat: the channel's read and send permissions. */
  | { readonly kind: 'nodeChat'; readonly nodeId: string; readonly chatDoc: string }
  /** A document of the 1:1 chat between `selfCid` and `peerCid`. */
  | { readonly kind: 'pair'; readonly selfCid: bigint; readonly peerCid: bigint; readonly docId: string }
  /** A scratchpad document: this account, this device. */
  | { readonly kind: 'scratchpad'; readonly account: bigint; readonly docId: string };

/** Why a picture could not be stored or fetched, in terms a member can be told. */
export type PictureFailure =
  /** Nobody has stored it for this document (or it was deleted with it). */
  | { readonly kind: 'notFound' }
  /** The member may not read (or write) this document's pictures. */
  | { readonly kind: 'notPermitted' }
  /** Larger than the store keeps. */
  | { readonly kind: 'tooLarge'; readonly maxBytes: number }
  /** The document or the workspace has no room for another picture; `detail` says which. */
  | { readonly kind: 'full'; readonly detail: string }
  /** The store cannot be reached now: no connection to the server or the peer. */
  | { readonly kind: 'offline' }
  /** What arrived is not the picture the id names. */
  | { readonly kind: 'damaged' }
  /** The store answered, but cannot keep or give pictures now; `detail` says why. */
  | { readonly kind: 'unavailable'; readonly detail: string };

export type PictureResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: PictureFailure };

export interface PicturePort {
  /** Keeps `bytes` under `contentId` for `doc`. Storing bytes the document already holds succeeds. */
  put(doc: PictureDocument, contentId: string, bytes: Uint8Array): Promise<PictureResult<void>>;
  /** The bytes kept under `contentId` for `doc`, unverified: the caller checks them against the id. */
  get(doc: PictureDocument, contentId: string): Promise<PictureResult<Uint8Array>>;
  /** The largest picture this store keeps for `doc`: the one limit a picture is held to, told before any of it is sent. */
  maxBytes(doc: PictureDocument): Promise<PictureResult<number>>;
}

const CONTENT_ID: RegExp = /^sha256-[0-9a-f]{64}$/;

/** Whether `id` is a picture's content id: `sha256-` and 64 lowercase hex digits, nothing else. */
export function isPictureId(id: string): boolean {
  return CONTENT_ID.test(id);
}

/** The hex digest a content id names, for stores keyed by the bare SHA-256. */
export function digestOf(contentId: string): string {
  if (!isPictureId(contentId)) throw new Error(`not a picture's content id: "${contentId}"`);
  return contentId.slice('sha256-'.length);
}

export const ok = <T>(value: T): PictureResult<T> => ({ ok: true, value });
export const failed = <T>(failure: PictureFailure): PictureResult<T> => ({ ok: false, failure });

const MIB: number = 1024 * 1024;

/** How a refusal to add a picture begins, so the ribbon passes it on as it is. */
export const PICTURE_NOT_ADDED: string = 'The picture was not added.';

/** What a member is told about `failure`. */
export function describePictureFailure(failure: PictureFailure): string {
  switch (failure.kind) {
    case 'notFound': return 'This picture is not stored with the document.';
    case 'notPermitted': return 'You do not have access to this document\'s pictures.';
    case 'tooLarge': return `Pictures in this document can be at most ${Math.floor(failure.maxBytes / MIB)} MB.`;
    case 'full': return failure.detail;
    case 'offline': return 'The picture cannot be reached while you are offline.';
    case 'damaged': return 'The stored picture is damaged.';
    case 'unavailable': return failure.detail;
  }
}

/** The short label drawn in the box where a picture could not be shown. */
export function pictureMissingLabel(failure: PictureFailure): string {
  switch (failure.kind) {
    case 'notFound': return 'picture not available: not stored with this document';
    case 'notPermitted': return 'picture not available: you have no access to it';
    case 'tooLarge': return 'picture not available: too large';
    case 'full': return 'picture not available';
    case 'offline': return 'picture not available: offline';
    case 'damaged': return 'picture not available: the stored copy is damaged';
    case 'unavailable': return 'picture not available: the store cannot be reached';
  }
}
