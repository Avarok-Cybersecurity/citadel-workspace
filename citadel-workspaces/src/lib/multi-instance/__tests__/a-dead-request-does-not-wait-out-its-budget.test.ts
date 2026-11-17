/**
 * When the queue gives up, the caller must stop waiting.
 *
 * `outbound-queue` retries a proxied request MAX_RETRIES times on a deadline
 * deliberately shorter than `sendToLeader`'s own 30s — its comment says so —
 * then emits `outbound-failed` and drops the entry. Nothing listened for that.
 * So the queue stopped trying, and the caller went on waiting for an ack nobody
 * was going to obtain: about ten seconds of a spinner over a decision already
 * taken, and then a timeout that reports the wrong reason.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendToLeader } from '../send-to-leader';
import { eventEmitter } from '@/lib/event-emitter';
import type { AckResult } from '../outbound-queue';

const channel: { send: ReturnType<typeof vi.fn> } = { send: vi.fn() };

afterEach((): void => { channel.send.mockClear(); });

describe('a proxied request the queue has given up on', () => {
  it('settles as soon as the queue says so', async (): Promise<void> => {
    const pending: Promise<AckResult> = sendToLeader(channel, { hello: true }, 'req-1');

    eventEmitter.emit('outbound-failed', {
      requestId: 'req-1',
      error: 'Max retries (3) exceeded',
      payload: {},
    });

    const result: AckResult = await pending;
    expect(result.status).toBe('error');
    expect(result.error).toContain('Max retries');
  });

  it('ignores a failure belonging to a different request', async (): Promise<void> => {
    const pending: Promise<AckResult> = sendToLeader(channel, { hello: true }, 'req-2');

    eventEmitter.emit('outbound-failed', { requestId: 'somebody-else', error: 'nope' });
    eventEmitter.emit('outbound-ack', { requestId: 'req-2', status: 'processed' });

    expect((await pending).status).toBe('processed');
  });

  it('still resolves normally on an ack', async (): Promise<void> => {
    const pending: Promise<AckResult> = sendToLeader(channel, { hello: true }, 'req-3');

    eventEmitter.emit('outbound-ack', { requestId: 'req-3', status: 'processed' });

    expect((await pending).status).toBe('processed');
  });

  it('leaves no listener behind once it has settled', async (): Promise<void> => {
    // Both handlers are registered per call, so one that outlives its promise
    // is a leak per proxied request — and this path runs on every request a
    // follower tab makes.
    const before: number = eventEmitter.listenerCount('outbound-failed');
    const pending: Promise<AckResult> = sendToLeader(channel, {}, 'req-4');
    eventEmitter.emit('outbound-ack', { requestId: 'req-4', status: 'processed' });
    await pending;

    expect(eventEmitter.listenerCount('outbound-failed')).toBe(before);
  });
});
