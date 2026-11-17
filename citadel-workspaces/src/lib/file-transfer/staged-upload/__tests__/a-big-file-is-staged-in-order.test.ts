// @vitest-environment node
// Node's Blob reads its slices (jsdom's has no arrayBuffer); the browser's File is a Blob.
/**
 * A browser file of any size up to the ceiling is staged on the agent in order,
 * one acknowledged chunk at a time -- no 16 MiB whole-file frame, and a refusal
 * before anything is read when the file cannot be sent at all.
 *
 * The port is a stand-in agent that checks each chunk lands where the last ended,
 * as the real one does (kernel/staged_uploads.rs): it is the I/O edge, nothing else.
 */
import { describe, it, expect } from 'vitest';
import { planChunks, stagingRefusal, STAGED_UPLOAD_CEILING_BYTES, STAGE_CHUNK_BYTES } from '../chunk-plan';
import { stageFile, type Readable, type StageChunk, type StagePort } from '../stage-file';

const go: AbortSignal = new AbortController().signal;
const named = (bytes: Uint8Array, name: string): Readable => Object.assign(new Blob([bytes as Uint8Array<ArrayBuffer>]), { name });

describe('planChunks', () => {
  it('covers the file exactly once, in order, never over the chunk size', () => {
    const spans: { offset: number; length: number }[] = planChunks(10, 4);
    expect(spans).toEqual([{ offset: 0, length: 4 }, { offset: 4, length: 4 }, { offset: 8, length: 2 }]);
    expect(planChunks(8, 4)).toEqual([{ offset: 0, length: 4 }, { offset: 4, length: 4 }]);
    expect(planChunks(0, 4)).toEqual([]);
  });

  it('refuses a chunk size that would never finish', () => {
    expect(() => planChunks(10, 0)).toThrow();
  });
});

describe('stagingRefusal', () => {
  it('names the one ceiling, and nothing below it', () => {
    expect(stagingRefusal(STAGED_UPLOAD_CEILING_BYTES)).toBeNull();
    expect(stagingRefusal(STAGED_UPLOAD_CEILING_BYTES + 1)).toMatch(/2 GB/);
    expect(stagingRefusal(0)).toMatch(/empty/);
  });
});

function agent(): { port: StagePort; chunks: StageChunk[]; held: () => Uint8Array } {
  const chunks: StageChunk[] = [];
  let received: number = 0;
  const port: StagePort = {
    newUploadId: (): string => 'u-1',
    sendChunk: async (chunk: StageChunk): Promise<number> => {
      if (chunk.offset !== received) throw new Error(`out of order at ${chunk.offset}`);
      chunks.push(chunk);
      received += chunk.data.length;
      return received;
    },
  };
  const held = (): Uint8Array => {
    const all: Uint8Array = new Uint8Array(received);
    for (const c of chunks) all.set(c.data, c.offset);
    return all;
  };
  return { port, chunks, held };
}

describe('stageFile', () => {
  it('stages a file larger than the old 16 MiB frame, chunk by chunk, byte for byte', async () => {
    const size: number = 17 * 1024 * 1024 + 5;
    const bytes: Uint8Array = new Uint8Array(size).map((_v: number, i: number) => i % 251);
    const file: Readable = named(bytes, 'video.mov');
    const { port, chunks, held } = agent();
    const progress: number[] = [];

    const id: string = await stageFile(file, port, (staged: number) => progress.push(staged), go);

    expect(id).toBe('u-1');
    expect(chunks.every((c: StageChunk) => c.data.length <= STAGE_CHUNK_BYTES && c.totalSize === size)).toBe(true);
    expect(chunks).toHaveLength(18);
    // Compared as buffers: a deep equality over 17 M elements exhausts the heap.
    expect(Buffer.from(held()).equals(Buffer.from(bytes))).toBe(true);
    expect(progress.at(-1)).toBe(size);
  });

  it('sends the next chunk only after the previous one is acknowledged', async () => {
    let inFlight: number = 0;
    let most: number = 0;
    const port: StagePort = {
      newUploadId: (): string => 'u-2',
      sendChunk: async (chunk: StageChunk): Promise<number> => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((r: (v: unknown) => void) => setTimeout(r, 1));
        inFlight -= 1;
        return chunk.offset + chunk.data.length;
      },
    };
    await stageFile(named(new Uint8Array(3 * STAGE_CHUNK_BYTES), 'a.bin'), port, () => undefined, go);
    expect(most).toBe(1);
  });

  it('refuses an over-ceiling file before reading or sending anything', async () => {
    const { port, chunks } = agent();
    const huge: { name: string; size: number; slice: () => Blob } = {
      name: 'disk.img', size: STAGED_UPLOAD_CEILING_BYTES + 1,
      slice: (): Blob => { throw new Error('read'); },
    };
    await expect(stageFile(huge, port, () => undefined, go)).rejects.toThrow(/2 GB/);
    expect(chunks).toHaveLength(0);
  });

  it('stops at the agent\'s refusal and reports it', async () => {
    const port: StagePort = {
      newUploadId: (): string => 'u-3',
      sendChunk: async (): Promise<number> => { throw new Error('the agent is already holding 2 GB'); },
    };
    await expect(stageFile(named(new Uint8Array(10), 'a.bin'), port, () => undefined, go)).rejects.toThrow(/already holding/);
  });

  it('stops at the next chunk once cancelled', async () => {
    const stop: AbortController = new AbortController();
    const { port, chunks } = agent();
    const counting: StagePort = {
      newUploadId: port.newUploadId,
      sendChunk: async (chunk: StageChunk): Promise<number> => {
        const held: number = await port.sendChunk(chunk);
        stop.abort();
        return held;
      },
    };
    await expect(stageFile(named(new Uint8Array(3 * STAGE_CHUNK_BYTES), 'a.bin'), counting, () => undefined, stop.signal))
      .rejects.toThrow(/Cancelled/);
    expect(chunks).toHaveLength(1);
  });
});
