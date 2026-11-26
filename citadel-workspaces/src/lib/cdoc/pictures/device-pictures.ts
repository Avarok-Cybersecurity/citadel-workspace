/**
 * A scratchpad document's pictures: kept on this device, in the agent's LocalDB under this
 * account, as the scratchpad's files are (lib/scratchpad/scratchpad-blobs.ts), each document in
 * a key space of its own. Nothing leaves the device. Pure over its LocalDB port (SBIO).
 */
import { documentPictureBlobs, NotKeptHere, SCRATCHPAD_FILE_LIMIT, type Hash, type ScratchpadBlobs } from '@/lib/scratchpad/scratchpad-blobs';
import type { LocalDbPort } from '@/lib/cdoc/chat/chat-local-db';
import { digestOf, failed, ok, type PictureDocument, type PicturePort, type PictureResult } from './picture-port';

function blobsOf(doc: PictureDocument, db: LocalDbPort, hash: Hash): ScratchpadBlobs {
  if (doc.kind !== 'scratchpad') throw new Error(`this device keeps only scratchpad pictures, not a ${doc.kind} document's`);
  return documentPictureBlobs(doc.account, doc.docId, db, hash);
}

/** `hash`: the bare hex SHA-256 the device store keys by. */
export function devicePictures(db: LocalDbPort, hash: Hash): PicturePort {
  return {
    put: async (doc: PictureDocument, contentId: string, bytes: Uint8Array): Promise<PictureResult<void>> => {
      if (bytes.length > SCRATCHPAD_FILE_LIMIT) return failed({ kind: 'tooLarge', maxBytes: SCRATCHPAD_FILE_LIMIT });
      const kept: string = await blobsOf(doc, db, hash).keep(bytes);
      if (kept !== digestOf(contentId)) throw new Error(`the picture kept as ${contentId} was stored as ${kept}`);
      return ok(undefined);
    },
    maxBytes: async (doc: PictureDocument): Promise<PictureResult<number>> => {
      blobsOf(doc, db, hash);
      return ok(SCRATCHPAD_FILE_LIMIT);
    },
    get: async (doc: PictureDocument, contentId: string): Promise<PictureResult<Uint8Array>> => {
      try {
        return ok(await blobsOf(doc, db, hash).read(digestOf(contentId)));
      } catch (error: unknown) {
        if (error instanceof NotKeptHere) return failed({ kind: 'notFound' });
        throw error;
      }
    },
  };
}
