/**
 * Staging a browser file on the agent: read a slice, send it, wait for the
 * acknowledgement, then the next. One chunk in flight at a time is the backpressure:
 * the browser never holds more than one chunk beyond what the agent has written,
 * whatever the file's size.
 *
 * The I/O is a port (`StagePort`), so this is testable without a socket; the real
 * port is stage-port.ts.
 */
import { planChunks, stagingRefusal, STAGE_CHUNK_BYTES, type ChunkSpan } from './chunk-plan';
import { holdReload } from '@/lib/pwa/reload-safety';

export interface StageChunk {
  uploadId: string;
  fileName: string;
  totalSize: number;
  offset: number;
  data: Uint8Array;
}

export interface StagePort {
  /** Sends one chunk; resolves with the bytes the agent now holds, rejects with its refusal. */
  sendChunk: (chunk: StageChunk) => Promise<number>;
  newUploadId: () => string;
}

export type StageProgress = (stagedBytes: number, totalBytes: number) => void;

/** A file's bytes as the browser can read them: a `File` or `Blob`. */
export type Readable = Pick<Blob, 'size' | 'slice'> & { name: string };

/** Stages `file` and resolves with the upload id `SendFile { StagedUpload }` names. */
export async function stageFile(file: Readable, port: StagePort, onProgress: StageProgress, signal: AbortSignal): Promise<string> {
  const refusal: string | null = stagingRefusal(file.size);
  if (refusal !== null) throw new Error(refusal);
  const uploadId: string = port.newUploadId();
  const spans: ChunkSpan[] = planChunks(file.size, STAGE_CHUNK_BYTES);
  // Only this page holds the file's bytes: a reload now would lose the upload.
  const releaseReload: () => void = holdReload('upload');
  try {
    await stageSpans(file, port, onProgress, signal, uploadId, spans);
  } finally {
    releaseReload();
  }
  return uploadId;
}

async function stageSpans(
  file: Readable, port: StagePort, onProgress: StageProgress, signal: AbortSignal, uploadId: string, spans: ChunkSpan[],
): Promise<void> {
  for (const span of spans) {
    if (signal.aborted) throw new Error('Cancelled before the file was ready.');
    const data: Uint8Array = new Uint8Array(await file.slice(span.offset, span.offset + span.length).arrayBuffer());
    const held: number = await port.sendChunk({
      uploadId, fileName: file.name, totalSize: file.size, offset: span.offset, data,
    });
    const expected: number = span.offset + span.length;
    if (held !== expected) {
      throw new Error(`The agent holds ${held} bytes of ${file.name}; expected ${expected}.`);
    }
    onProgress(held, file.size);
  }
}
