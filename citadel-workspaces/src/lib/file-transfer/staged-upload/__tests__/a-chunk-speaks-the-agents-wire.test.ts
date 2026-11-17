/**
 * A chunk goes out as the agent's `StageUploadChunk` and is settled by the answer
 * with its own request_id, not another chunk's. The socket is the only stand-in.
 */
import { describe, it, expect } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { agentStagePort } from '../stage-port';

type Wire = { StageUploadChunk: Record<string, unknown> };

describe('agentStagePort', () => {
  it('sends the agent\'s shape and resolves with the bytes it holds', async () => {
    const sent: Wire[] = [];
    const port: ReturnType<typeof agentStagePort> = agentStagePort(7n, async (r: Record<string, unknown>): Promise<void> => {
      sent.push(r as Wire);
      const id: unknown = (r as Wire).StageUploadChunk.request_id;
      queueMicrotask((): void => {
        eventEmitter.emit('websocket-message', { StageUploadChunkSuccess: { request_id: 'someone-else', received: 1n } });
        eventEmitter.emit('websocket-message', { StageUploadChunkSuccess: { request_id: id, received: 3n } });
      });
    });

    const held: number = await port.sendChunk({ uploadId: 'u', fileName: 'a.bin', totalSize: 5, offset: 0, data: new Uint8Array([1, 2, 3]) });

    expect(held).toBe(3);
    expect(sent[0].StageUploadChunk).toMatchObject({
      cid: 7n, upload_id: 'u', file_name: 'a.bin', total_size: 5n, offset: 0n, data: [1, 2, 3],
    });
  });

  it('rejects with the agent\'s refusal', async () => {
    const port: ReturnType<typeof agentStagePort> = agentStagePort(7n, async (r: Record<string, unknown>): Promise<void> => {
      const id: unknown = (r as Wire).StageUploadChunk.request_id;
      queueMicrotask((): void => {
        eventEmitter.emit('websocket-message', { StageUploadChunkFailure: { request_id: id, message: 'over the limit' } });
      });
    });
    await expect(port.sendChunk({ uploadId: 'u', fileName: 'a', totalSize: 1, offset: 0, data: new Uint8Array([1]) }))
      .rejects.toThrow('over the limit');
  });
});
