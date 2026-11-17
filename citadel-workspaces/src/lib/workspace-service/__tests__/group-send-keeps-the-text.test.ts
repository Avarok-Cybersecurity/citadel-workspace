/**
 * `sendGroupMessage` resolved when the frame left, and the composer clears on
 * resolve — so a refusal (a store failure, or the rate limiter's "Please slow
 * down") threw the user's text away: the message never appeared, and the
 * refusal arrives as a generic `Error` that no handler surfaces.
 *
 * The success variant is ALSO the broadcast every other member receives for
 * every message, so type-only matching would let someone else's message resolve
 * this write. These pin both halves.
 */
import { describe, it, expect, vi  } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { awaitWriteResponse } from '../await-write-response';

const ownAnswer: { GroupMessageNotification: { group_id: string; message: { content: string; }; }; } = {
  GroupMessageNotification: { group_id: 'g1', message: { content: 'my text' } },
};
const someoneElse: { GroupMessageNotification: { group_id: string; message: { content: string; }; }; } = {
  GroupMessageNotification: { group_id: 'g1', message: { content: 'their text' } },
};

const matcher = (payload: unknown): boolean => {
  const p: { group_id?: string; message?: { content?: string; }; } = payload as { group_id?: string; message?: { content?: string } };
  return p?.group_id === 'g1' && p?.message?.content === 'my text';
};

describe('a gated group send', () => {
  it('resolves on its own answer', async () => {
    const pending: Promise<void> = awaitWriteResponse('SendGroupMessage', async () => {}, matcher);
    await Promise.resolve();
    eventEmitter.emit('workspace:raw-response', ownAnswer);
    await expect(pending).resolves.toBeUndefined();
  });

  it('is NOT resolved by another member\'s message', async () => {
    vi.useFakeTimers();
    try {
      const pending: Promise<void> = awaitWriteResponse('SendGroupMessage', async () => {}, matcher);
      const settled: ReturnType<typeof vi.fn> = vi.fn();
      void pending.then(settled, settled);

      await vi.advanceTimersByTimeAsync(0);
      eventEmitter.emit('workspace:raw-response', someoneElse);
      // Flush the promise's own continuations. A single `await Promise.resolve()`
      // does NOT: the first version of this test asserted before `settled` could
      // run, so it passed with the matcher deleted.
      await vi.advanceTimersByTimeAsync(0);

      // Type-only matching would have reported success here, for a send the
      // server may still refuse.
      expect(settled, 'another member\'s message resolved this send').not.toHaveBeenCalled();

      eventEmitter.emit('workspace:raw-response', ownAnswer);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects on a server refusal, so the composer can keep the text', async () => {
    const pending: Promise<void> = awaitWriteResponse('SendGroupMessage', async () => {}, matcher);
    await Promise.resolve();
    eventEmitter.emit('workspace:raw-response', { Error: 'Rate limit exceeded. Please slow down.' });
    await expect(pending).rejects.toThrow(/slow down/i);
  });
});
