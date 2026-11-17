/**
 * A write whose send fails rejects with the send's error, and leaves nothing behind.
 *
 * It used to leave its listener on `workspace:raw-response` and its 15-second timer running; the
 * timer then rejected a promise nobody held. The role table's list is sent on first use, and
 * before a session exists that send fails, so every screen showing a role badge would have
 * left one of these behind.
 *
 * Doubled: the send, which throws as WorkspaceService does with no session.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { awaitWriteResponse, WRITE_RESPONSE_TIMEOUT_MS } from '../await-write-response';

afterEach((): void => { vi.useRealTimers(); });

describe('a write that cannot be sent', () => {
  it('rejects with the send error and removes its listener and timer', async () => {
    vi.useFakeTimers();
    const before: number = eventEmitter.listenerCount('workspace:raw-response');
    const unhandled: unknown[] = [];
    const record = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', record);
    try {
      await expect(awaitWriteResponse('Roles', async (): Promise<void> => { throw new Error('No active connection available.'); }))
        .rejects.toThrow('No active connection available.');
      expect(eventEmitter.listenerCount('workspace:raw-response')).toBe(before);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(WRITE_RESPONSE_TIMEOUT_MS + 1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', record);
    }
  });
});
