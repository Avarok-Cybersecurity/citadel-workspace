/**
 * A write must not report success for something the server is about to refuse.
 *
 * `sendProtocolRequest` resolves once the request reaches the local WASM sink,
 * and the server answers a refusal as a RESPONSE — which can never reject that
 * promise. So the user saw, five seconds apart and in opposite corners:
 *
 *   green  "Office Deleted — Engineering has been deleted successfully"
 *   red    "Failed to delete node: Permission denied: EditTreeStructure required"
 *
 * with the node still in the tree. Every downstream failure path was unreachable
 * as a consequence — TreeNodesSection's delete dialog closes only on success and
 * renders its own role="alert", and neither could ever fire.
 */
import { describe, it, expect, vi, beforeEach, afterEach  } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import {
  awaitWriteResponse,
  WRITE_RESPONSE_TIMEOUT_MS,
} from '@/lib/workspace-service/await-write-response';

/** Answer the write the way the server would. */
function serverAnswers(response: unknown): void {
  queueMicrotask(() => eventEmitter.emit('workspace:raw-response', response));
}

describe('a write', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves when the server accepts it', async () => {
    const send: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<void> => {
      serverAnswers({ NodeDeleted: { node_id: 'n1' } });
    });

    await expect(awaitWriteResponse('DeleteNode', send)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('REJECTS when the server refuses it, carrying the reason', async () => {
    const send: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<void> => {
      serverAnswers({ Error: 'Permission denied: EditTreeStructure required' });
    });

    await expect(awaitWriteResponse('DeleteNode', send)).rejects.toThrow(
      /EditTreeStructure required/
    );
  });

  it("does not accept another write's success as its own", async () => {
    const send: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<void> => {
      // A Node response cannot satisfy a delete.
      serverAnswers({ Node: { id: 'n1' } });
      setTimeout(() => eventEmitter.emit('workspace:raw-response', { Error: 'nope' }), 5);
    });

    await expect(awaitWriteResponse('DeleteNode', send)).rejects.toThrow(/nope/);
  });

  it('fails rather than hanging when the server never answers', async () => {
    vi.useFakeTimers();
    const send: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<undefined> => undefined);

    const pending: Promise<void> = awaitWriteResponse('DeleteNode', send);
    const assertion: Promise<void> = expect(pending).rejects.toThrow(/did not answer/);
    await vi.advanceTimersByTimeAsync(WRITE_RESPONSE_TIMEOUT_MS + 1);
    await assertion;
  });

  it('surfaces a send failure as itself', async () => {
    const send: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<never> => {
      throw new Error('socket is closed');
    });

    await expect(awaitWriteResponse('DeleteNode', send)).rejects.toThrow('socket is closed');
  });
});
