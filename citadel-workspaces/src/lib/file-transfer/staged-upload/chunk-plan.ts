/**
 * Which slices of a browser file go to the agent, in what order. Pure.
 *
 * A browser send carried the whole file in one frame, capped at 16 MiB. It is now
 * staged on the agent in acknowledged chunks (agent: kernel/staged_uploads.rs),
 * then sent whole over the Citadel file transfer. These two constants mirror the
 * agent's, which is the authority; a file over the ceiling is refused here, before
 * anything is read, with the same number the dialog shows.
 */

/** The largest file this browser can send: `MAX_STAGED_UPLOAD_BYTES` on the agent. */
export const STAGED_UPLOAD_CEILING_BYTES: number = 2 * 1024 * 1024 * 1024;

/** The largest chunk the agent accepts: `MAX_STAGE_CHUNK_BYTES`. */
export const STAGE_CHUNK_BYTES: number = 1024 * 1024;

export interface ChunkSpan {
  offset: number;
  length: number;
}

/** Why a file cannot be staged, or null when it can. */
export function stagingRefusal(size: number): string | null {
  if (size <= 0) return 'An empty file cannot be sent.';
  if (size > STAGED_UPLOAD_CEILING_BYTES) return 'Files sent from the browser are limited to 2 GB.';
  return null;
}

/** The spans of a `size`-byte file, `chunkBytes` at a time, covering it exactly once in order. */
export function planChunks(size: number, chunkBytes: number): ChunkSpan[] {
  if (!Number.isInteger(chunkBytes) || chunkBytes <= 0) throw new Error(`chunk size ${chunkBytes} is not a positive integer`);
  const spans: ChunkSpan[] = [];
  for (let offset: number = 0; offset < size; offset += chunkBytes) {
    spans.push({ offset, length: Math.min(chunkBytes, size - offset) });
  }
  return spans;
}
