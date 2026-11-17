/**
 * Reading a stored file's bytes into the page: the agent pulls it (DownloadFile, as Download
 * does), then hands it over chunk by chunk (InternalServiceRequest::ReadPulledFileChunk, the
 * reverse of StageUploadChunk). The chunks are checked for continuity and assembled into one
 * Uint8Array that owns its buffer, so it moves to the cdoc worker as a Transferable.
 *
 * Pure over its I/O (SBIO): the pull and the chunk read are handed in.
 */
import type { RevfsNode } from '@/types/revfs-types';
import type { PulledChunk } from '@/types/revfs-intents';

export interface PulledFileIO {
  /** Pulls the file to the agent (DownloadFile); resolves once the pull completed. */
  readonly pull: (node: RevfsNode) => Promise<void>;
  /** ReadPulledFileChunk: up to maxLen bytes of the pulled file from offset. */
  readonly readChunk: (node: RevfsNode, offset: bigint, maxLen: number) => Promise<PulledChunk>;
}

/** The agent's MAX_READ_CHUNK_BYTES: the most one ReadPulledFileChunk answer carries. */
export const READ_CHUNK_BYTES: number = 1024 * 1024;

/**
 * The largest file read into the page: the agent's MAX_BROWSER_TRANSFER_TOTAL_BYTES (256 MiB),
 * which it enforces too. Declared here because the client bindings do not export it.
 */
export const MAX_PULLED_FILE_BYTES: bigint = 256n * 1024n * 1024n;

export class PulledFileError extends Error {
  constructor(name: string, message: string) {
    super(`${name} could not be read: ${message}`);
    this.name = 'PulledFileError';
  }
}

/** Reads one chunk of the file at `offset`: ReadPulledFileChunk, however the file is named. */
export type ChunkReader = (offset: bigint, maxLen: number) => Promise<PulledChunk>;

function check(name: string, chunk: PulledChunk, expected: bigint, total: bigint | null): void {
  if (total !== null && chunk.totalSize !== total) throw new PulledFileError(name, `its size changed from ${total} to ${chunk.totalSize} bytes while reading`);
  if (chunk.offset !== expected) throw new PulledFileError(name, `the agent answered offset ${chunk.offset} where ${expected} was asked for`);
  if (chunk.data.length > READ_CHUNK_BYTES) throw new PulledFileError(name, `a chunk of ${chunk.data.length} bytes is over the ${READ_CHUNK_BYTES} asked for`);
  if (chunk.offset + BigInt(chunk.data.length) > chunk.totalSize) throw new PulledFileError(name, 'a chunk runs past the end of the file');
}

/**
 * A file the agent holds for this session, read whole and in order. `limit` is the most the
 * caller will take; a larger file is refused after its first chunk names its size.
 */
export async function readAgentFile(name: string, readChunk: ChunkReader, limit: bigint): Promise<Uint8Array> {
  const first: PulledChunk = await readChunk(0n, READ_CHUNK_BYTES);
  check(name, first, 0n, null);
  const total: bigint = first.totalSize;
  if (total > limit) throw new PulledFileError(name, `it is ${total} bytes, over the ${limit} a page may read`);
  const out: Uint8Array = new Uint8Array(Number(total));
  out.set(first.data, 0);
  let at: bigint = BigInt(first.data.length);
  while (at < total) {
    const chunk: PulledChunk = await readChunk(at, READ_CHUNK_BYTES);
    check(name, chunk, at, total);
    if (chunk.data.length === 0) throw new PulledFileError(name, `the agent sent nothing at offset ${at} of ${total}`);
    out.set(chunk.data, Number(at));
    at += BigInt(chunk.data.length);
  }
  return out;
}

export async function readPulledFile(node: RevfsNode, io: PulledFileIO): Promise<Uint8Array> {
  await io.pull(node);
  return readAgentFile(node.name, (offset: bigint, maxLen: number): Promise<PulledChunk> => io.readChunk(node, offset, maxLen), MAX_PULLED_FILE_BYTES);
}
