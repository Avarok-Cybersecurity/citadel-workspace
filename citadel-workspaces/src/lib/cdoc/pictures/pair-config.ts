/**
 * How a direct chat's document pictures travel between the two peers (pair-pictures.ts, pair-fetch.ts). Every
 * setting is required (PCND); PAIR_PICTURES is the one production configuration, each value
 * derived from what bounds it, with the reason.
 */
import { SCRATCHPAD_FILE_LIMIT } from '@/lib/scratchpad/scratchpad-blobs';
import { CHAT_SYNC } from '../chat/chat-config';

export interface PairPictureConfig {
  /** The CRDT format the envelope names (pictures are not CRDT, but the envelope carries one). */
  readonly docVersion: number;
  /** The bytes of a picture one `picture_chunk` carries; every chunk but the last is exactly this long. */
  readonly chunkBytes: number;
  /** The largest picture kept or exchanged: a larger one is `tooLarge`. */
  readonly maxBytes: number;
  /**
   * How long a `picture_want` waits for the peer's next answer (its first chunk, each chunk
   * after, or its `picture_none`) before the picture is `offline`: no peer, or one gone quiet.
   */
  readonly answerDeadlineMs: number;
}

export const PAIR_PICTURES: PairPictureConfig = {
  docVersion: CHAT_SYNC.docVersion,
  // A chunk is one CdocChatSync command, held to the document sync's wire bound (64 KiB, ~230 KB
  // as the agent socket's JSON number array) less the same envelope headroom: the picture
  // envelope (doc id, content id, three counts) is well inside it. So a picture never makes a
  // larger frame than a document's own diff chunks do.
  chunkBytes: CHAT_SYNC.maxChunkBytes,
  // Each side keeps the picture in its device store, whose cap this is: a picture neither side
  // could keep is refused before it is sent.
  maxBytes: SCRATCHPAD_FILE_LIMIT,
  // Before its first chunk the peer reads the whole picture back from its agent's LocalDB (up to
  // 16 MiB, ~56 MB of JSON number arrays through its socket) and hashes it; 20 s covers that on
  // a slow device. Later chunks reset the wait, so a large picture is not cut off by its size.
  answerDeadlineMs: 20_000,
};

/** How many chunks a picture of `size` bytes travels in: one at least, so an empty one still answers. */
export function chunksFor(size: number, chunkBytes: number): number {
  return Math.max(1, Math.ceil(size / chunkBytes));
}
