/**
 * ReadPulledFileChunk on the wire: the request names the file as its pull did, and only the
 * answer carrying this request's id settles it. A Success whose fields are not the declared
 * types (u64 as bigint, bytes as a number array) is a failure, never a chunk.
 *
 * The double is the agent end of the socket: `sendInternalServiceRequest` records the request
 * and the test speaks the agent's answers onto the real event emitter, as the WebSocket does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { backendReadPulledChunk, readChunkAnswer, readChunkRequest, type ReadChunkAsk } from '../revfs-io-read-chunk';
import type { ReadChunkAnswer, RevfsIntentResult } from '@/types/revfs-intents';

const ASK: ReadChunkAsk = { cid: 7n, peerCid: null, virtualDir: '/v/notes.docx', offset: 1048576n, maxLen: 1048576 };

function start(send: (request: unknown) => Promise<void> = async (): Promise<void> => undefined): { pending: Promise<RevfsIntentResult>; sent: unknown[] } {
  const sent: unknown[] = [];
  const pending: Promise<RevfsIntentResult> = backendReadPulledChunk({ sendInternalServiceRequest: async (r: unknown): Promise<void> => { sent.push(r); await send(r); } }, ASK);
  return { pending, sent };
}
const idOf = (sent: unknown[]): string => (sent[0] as { ReadPulledFileChunk: { request_id: string } }).ReadPulledFileChunk.request_id;

afterEach((): void => { vi.useRealTimers(); });

describe('ReadPulledFileChunk', () => {
  it('asks for the file by the virtual directory its pull used, at the offset and length given', () => {
    expect(readChunkRequest('r1', ASK)).toEqual({
      ReadPulledFileChunk: { request_id: 'r1', cid: 7n, peer_cid: null, virtual_directory: '/v/notes.docx', offset: 1048576n, max_len: 1048576 },
    });
  });

  it('settles on its own Success, with the bytes as bytes and the u64s as bigints', async () => {
    const { pending, sent } = start();
    await Promise.resolve();
    eventEmitter.emit('websocket-message', { ReadPulledFileChunkSuccess: { cid: 7n, request_id: 'another', total_size: 9n, offset: 0n, data: [9] } });
    eventEmitter.emit('websocket-message', { ReadPulledFileChunkSuccess: { cid: 7n, request_id: idOf(sent), total_size: 1048579n, offset: 1048576n, data: [1, 2, 255] } });
    expect(await pending).toEqual({
      type: 'backend-read-pulled-chunk',
      answer: { kind: 'chunk', chunk: { totalSize: 1048579n, offset: 1048576n, data: new Uint8Array([1, 2, 255]) } },
    });
  });

  it('passes on the agent\'s reason when it refuses', async () => {
    const { pending, sent } = start();
    await Promise.resolve();
    eventEmitter.emit('websocket-message', { ReadPulledFileChunkFailure: { cid: 7n, request_id: idOf(sent), message: 'no pulled file at /v/notes.docx' } });
    expect(await pending).toEqual({ type: 'backend-read-pulled-chunk', answer: { kind: 'failed', message: 'no pulled file at /v/notes.docx' } });
  });

  it('calls a Success with a number for a u64, or a byte out of range, malformed', () => {
    const malformed: ReadChunkAnswer = { kind: 'failed', message: 'the agent answered with a malformed chunk' };
    expect(readChunkAnswer({ ReadPulledFileChunkSuccess: { request_id: 'r', total_size: 3, offset: 0n, data: [1] } }, 'r')).toEqual(malformed);
    expect(readChunkAnswer({ ReadPulledFileChunkSuccess: { request_id: 'r', total_size: 3n, offset: 0n, data: [256] } }, 'r')).toEqual(malformed);
    expect(readChunkAnswer({ ReadPulledFileChunkSuccess: { request_id: 'r', total_size: 3n, offset: 0n, data: 'AQI=' } }, 'r')).toEqual(malformed);
    expect(readChunkAnswer({ DownloadFileFailure: { request_id: 'r', message: 'x' } }, 'r')).toBeNull();
  });

  it('fails with the send\'s error when the request cannot leave the page', async () => {
    const { pending } = start(async (): Promise<void> => { throw new Error('unknown variant `ReadPulledFileChunk`'); });
    expect(await pending).toEqual({ type: 'backend-read-pulled-chunk', answer: { kind: 'failed', message: 'unknown variant `ReadPulledFileChunk`' } });
  });

  it('fails, naming an older agent, when nothing answers in time', async () => {
    vi.useFakeTimers();
    const { pending } = start();
    await vi.advanceTimersByTimeAsync(60_000);
    const result: RevfsIntentResult = await pending;
    expect(result).toMatchObject({ type: 'backend-read-pulled-chunk', answer: { kind: 'failed' } });
    expect(JSON.stringify(result)).toContain('older than this page');
  });
});
