// @vitest-environment node
/**
 * The engine download's byte counter: every byte the stream yields is counted and passed on
 * unchanged, the response keeps what instantiateStreaming reads (status, Content-Type), and a
 * total is claimed only when Content-Length counts the bytes the stream yields. Node's own
 * Response and streams, no doubles.
 */
import { describe, expect, it } from 'vitest';
import type { ByteProgress } from '@/lib/app-loading/load-stage';
import { declaredTotal, withByteProgress } from '../progress-response';

function streamed(chunks: readonly Uint8Array[], headers: Record<string, string>, status: number = 200): Response {
  const body: ReadableStream<Uint8Array> = new ReadableStream<Uint8Array>({
    start(controller: ReadableStreamDefaultController<Uint8Array>): void {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(body, { status, headers });
}

const CHUNKS: readonly Uint8Array[] = [new Uint8Array([0, 97, 115, 109]), new Uint8Array([1, 0, 0, 0]), new Uint8Array([9, 9])];

describe('a download that reports its bytes', () => {
  it('counts each chunk as it passes and hands every byte on unchanged', async () => {
    const seen: ByteProgress[] = [];
    const counted: Response = withByteProgress(streamed(CHUNKS, { 'Content-Type': 'application/wasm', 'Content-Length': '10' }), (p: ByteProgress): void => { seen.push(p); });
    expect(counted.headers.get('Content-Type')).toBe('application/wasm');
    expect(counted.status).toBe(200);
    expect([...new Uint8Array(await counted.arrayBuffer())]).toEqual(CHUNKS.flatMap((c: Uint8Array): number[] => [...c]));
    expect(seen).toEqual([{ loaded: 0, total: 10 }, { loaded: 4, total: 10 }, { loaded: 8, total: 10 }, { loaded: 10, total: 10 }]);
  });

  it('claims no total for a compressed body, whose length counts other bytes than the stream yields', () => {
    expect(declaredTotal(new Headers({ 'Content-Length': '10', 'Content-Encoding': 'br' }))).toBeNull();
    expect(declaredTotal(new Headers({ 'Content-Length': '10', 'Content-Encoding': 'identity' }))).toBe(10);
    expect(declaredTotal(new Headers({}))).toBeNull();
    expect(declaredTotal(new Headers({ 'Content-Length': 'many' }))).toBeNull();
  });

  it('leaves a failed response alone, so the loader reports the failure itself', () => {
    const failed: Response = streamed([], {}, 404);
    let reports: number = 0;
    expect(withByteProgress(failed, (): void => { reports += 1; })).toBe(failed);
    expect(reports).toBe(0);
  });
});
