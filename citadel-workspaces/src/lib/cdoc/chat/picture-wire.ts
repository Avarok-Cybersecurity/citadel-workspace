/**
 * A document's picture messages on the wire (CdocChatPictureSync, inside the CdocChatSync
 * command): building what the peer receives and reading what it sent. Everything read here came
 * from the other peer, so every field is checked against what this client writes: the document
 * id's shape, the content id's, a chunk's index within its count, the count the size needs, the
 * size within the cap, and each chunk exactly as long as its place says. Anything else throws
 * ChatWireError; nothing past the fields this client reads is kept.
 */
import { isPictureSync, type CdocChatPictureSync, type CdocChatSyncPayload } from '@/types/cdoc-chat-sync';
import { isPictureId } from '../pictures/picture-port';
import { chunksFor } from '../pictures/pair-config';
import { bytes as wireBytes, count as wireCount, encodeChatSync, fail, isChatDocId } from './chat-wire';

/** The bounds a chunk is read against: the sender's, since both sides run this client. */
export interface PictureWireLimits {
  readonly chunkBytes: number;
  readonly maxBytes: number;
}

/** A picture message as read: for which document, and what it says. */
export interface PictureMessage {
  readonly docId: string;
  readonly sync: CdocChatPictureSync;
}

export function encodePictureSync(docId: string, docVersion: number, sync: CdocChatPictureSync): Uint8Array {
  return encodeChatSync({ doc_id: docId, doc_version: docVersion, sync });
}

/** The length chunk `index` of a `size`-byte picture has. */
function chunkLength(index: number, count: number, size: number, chunkBytes: number): number {
  return index < count - 1 ? chunkBytes : size - chunkBytes * (count - 1);
}

/** The chunks a picture is sent as, each the length its place says. */
export function pictureChunks(contentId: string, bytes: Uint8Array, chunkBytes: number): CdocChatPictureSync[] {
  const count: number = chunksFor(bytes.length, chunkBytes);
  return Array.from({ length: count }, (_: unknown, index: number): CdocChatPictureSync => ({
    kind: 'picture_chunk', content_id: contentId, index, count, size: bytes.length,
    chunk: bytes.slice(index * chunkBytes, index * chunkBytes + chunkLength(index, count, bytes.length, chunkBytes)),
  }));
}

/** The picture message `payload` carries, checked; throws ChatWireError on anything this client does not write. */
export function readPictureSync(payload: CdocChatSyncPayload, limits: PictureWireLimits): PictureMessage {
  if (!isChatDocId(payload.doc_id)) return fail('a picture message names no chat document');
  if (!isPictureSync(payload.sync)) return fail(`${payload.sync.kind} is not a picture message`);
  const s: Record<string, unknown> = payload.sync as unknown as Record<string, unknown>;
  const contentId: unknown = s.content_id;
  if (typeof contentId !== 'string' || !isPictureId(contentId)) return fail(`${payload.sync.kind}.content_id is not a picture's content id`);
  const docId: string = payload.doc_id;
  switch (payload.sync.kind) {
    case 'picture_have':
    case 'picture_want':
    case 'picture_none':
      return { docId, sync: { kind: payload.sync.kind, content_id: contentId } };
    case 'picture_chunk': {
      const size: number = wireCount(s.size, 'picture_chunk.size');
      if (size > limits.maxBytes) return fail(`a picture of ${size} bytes is over the ${limits.maxBytes}-byte cap`);
      const count: number = wireCount(s.count, 'picture_chunk.count');
      if (count !== chunksFor(size, limits.chunkBytes)) return fail(`a picture of ${size} bytes is not ${count} chunks`);
      const index: number = wireCount(s.index, 'picture_chunk.index');
      if (index >= count) return fail(`picture chunk ${index} of ${count}`);
      const chunk: Uint8Array = wireBytes(s.chunk, 'picture_chunk.chunk');
      const expected: number = chunkLength(index, count, size, limits.chunkBytes);
      if (chunk.length !== expected) return fail(`picture chunk ${index} is ${chunk.length} bytes, not ${expected}`);
      return { docId, sync: { kind: 'picture_chunk', content_id: contentId, index, count, size, chunk } };
    }
  }
}
