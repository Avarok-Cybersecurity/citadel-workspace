/**
 * A direct chat's document pictures: kept on each person's device, as the scratchpad's are
 * (documentPictureBlobs, under the account), and exchanged by content id over the pair's P2P
 * channel beside the document's own sync.
 *
 * - put: keeps the picture here, then tells the peer it `picture_have`s it (best effort).
 * - get: this device first, so a reopen works offline; otherwise wants it from the peer
 *   (pair-fetch.ts), keeping what arrives.
 * - The peer's `picture_want` is answered from this device's copy, in chunks, and only for a
 *   document this account keeps in its chat with THAT peer; anything else is `picture_none`,
 *   the same answer as a picture not kept, so an ask learns nothing more.
 * - The peer's `picture_have` for a document kept here is fetched at once, so the picture is on
 *   this device before the inserter goes offline.
 *
 * Pure over its ports (SBIO); the app's wiring is app-pictures.ts and lib/p2p/chat-document-inbox.ts.
 */
import type { CdocChatSyncPayload } from '@/types/cdoc-chat-sync';
import { encodePictureSync, pictureChunks, readPictureSync, type PictureMessage } from '../chat/picture-wire';
import { keepHere, readHere, wantFromPeer, type PairPicturePorts } from './pair-fetch';
import { failed, ok, type PictureDocument, type PictureFailure, type PicturePort, type PictureResult } from './picture-port';

export type { PairPicturePorts } from './pair-fetch';

function docIdOf(ports: PairPicturePorts, doc: PictureDocument): string {
  if (doc.kind !== 'pair' || doc.selfCid !== ports.transport.selfCid || doc.peerCid !== ports.transport.peerCid) {
    throw new Error(`these pictures are the chat between ${ports.transport.selfCid.toString()} and ${ports.transport.peerCid.toString()}, not a ${doc.kind} document's`);
  }
  return doc.docId;
}

export function pairPicturePort(ports: PairPicturePorts): PicturePort {
  return {
    put: async (doc: PictureDocument, contentId: string, bytes: Uint8Array): Promise<PictureResult<void>> => {
      const docId: string = docIdOf(ports, doc);
      if (bytes.length > ports.config.maxBytes) return failed({ kind: 'tooLarge', maxBytes: ports.config.maxBytes });
      await keepHere(ports, docId, contentId, bytes);
      // Best effort: a peer that misses it wants the picture when it draws it.
      ports.transport.send(encodePictureSync(docId, ports.config.docVersion, { kind: 'picture_have', content_id: contentId })).catch((error: unknown): void => {
        console.warn('[PairPictures] the peer was not told of a new picture; it will ask when it draws it', error);
      });
      return ok(undefined);
    },
    get: async (doc: PictureDocument, contentId: string): Promise<PictureResult<Uint8Array>> => {
      const docId: string = docIdOf(ports, doc);
      const here: Uint8Array | null = await readHere(ports, docId, contentId);
      return here !== null ? ok(here) : wantFromPeer(ports, docId, contentId);
    },
    maxBytes: async (doc: PictureDocument): Promise<PictureResult<number>> => {
      docIdOf(ports, doc);
      return ok(ports.config.maxBytes);
    },
  };
}

/** What a picture message from the peer led to; the app logs the ones that went wrong. */
export type PictureMessageOutcome =
  | 'sent'
  | 'none'
  | 'kept'
  | 'already here'
  | 'not shared'
  | 'refused'
  /** A chunk or a none: the want waiting for it reads it. */
  | 'answer'
  | { readonly failed: PictureFailure['kind'] };

async function answerWant(ports: PairPicturePorts, docId: string, contentId: string): Promise<PictureMessageOutcome> {
  const none = async (): Promise<PictureMessageOutcome> => {
    await ports.transport.send(encodePictureSync(docId, ports.config.docVersion, { kind: 'picture_none', content_id: contentId }));
    return 'none';
  };
  if (!(await ports.sharesWithPeer(docId))) return none();
  let bytes: Uint8Array | null;
  try {
    bytes = await readHere(ports, docId, contentId);
  } catch (error: unknown) {
    // A damaged copy is not given: the peer is told none, and the failure is still reported.
    await none();
    throw error;
  }
  if (bytes === null || bytes.length > ports.config.maxBytes) return none();
  for (const chunk of pictureChunks(contentId, bytes, ports.config.chunkBytes)) {
    await ports.transport.send(encodePictureSync(docId, ports.config.docVersion, chunk));
  }
  return 'sent';
}

async function heardHave(ports: PairPicturePorts, docId: string, contentId: string): Promise<PictureMessageOutcome> {
  if (!(await ports.sharesWithPeer(docId))) return 'not shared';
  if ((await readHere(ports, docId, contentId)) !== null) return 'already here';
  const got: PictureResult<Uint8Array> = await wantFromPeer(ports, docId, contentId);
  return got.ok ? 'kept' : { failed: got.failure.kind };
}

/** Acts on a picture message the peer sent the account, whether or not its document is open here. */
export async function heardPictureMessage(ports: PairPicturePorts, payload: CdocChatSyncPayload): Promise<PictureMessageOutcome> {
  let message: PictureMessage;
  try {
    message = readPictureSync(payload, ports.config);
  } catch (error: unknown) {
    console.warn('[PairPictures] refused a picture message from the peer', error);
    return 'refused';
  }
  const { docId, sync } = message;
  switch (sync.kind) {
    case 'picture_want': return answerWant(ports, docId, sync.content_id);
    case 'picture_have': return heardHave(ports, docId, sync.content_id);
    case 'picture_chunk':
    case 'picture_none':
      return 'answer';
  }
}
