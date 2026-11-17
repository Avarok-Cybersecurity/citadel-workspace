/**
 * The outbound retry engine has to be running for any of it to mean anything.
 *
 * `outbound-queue.ts` documents its own contract at the top of the file: "If no
 * ACK within ACK_TIMEOUT_MS, message is retried; Max MAX_RETRIES attempts; After
 * max retries, emits 'outbound-failed'". `checkTimeouts` runs only from the
 * poller that `start()` arms — and `start()` had no caller anywhere in
 * production. So none of that ever executed: `handleTimeout`, `MAX_RETRIES` and
 * the `outbound-failed` event were unreachable code behind a documented promise.
 *
 * A follower tab's request dropped at the wrong moment therefore had exactly one
 * recovery trigger — a leader-change replay — and otherwise waited out the full
 * 30s ACK timeout before failing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { outboundQueue } from '../outbound-queue';
import { eventEmitter } from '@/lib/event-emitter';
import { TIMEOUT } from '@/lib/timeout-constants';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  outboundQueue.stop();
  vi.useRealTimers();
});

describe('the retry engine', () => {
  it('retries a request that is never acknowledged', () => {
    const retries: string[] = [];
    const off: () => void = eventEmitter.on('outbound-retry', (d: { requestId: string }): number =>
      retries.push(d.requestId),
    );

    outboundQueue.start();
    const id: string = outboundQueue.enqueue({ kind: 'test' });

    // Nothing yet: the request has not been waiting long enough.
    vi.advanceTimersByTime(TIMEOUT.SERVER_REQUEST_MS / 2);
    expect(retries).toEqual([]);

    vi.advanceTimersByTime(TIMEOUT.SERVER_REQUEST_MS);
    expect(retries).toContain(id);

    off();
    outboundQueue.acknowledge(id, { status: 'processed' });
  });

  it('gives up after the documented number of attempts, and says so', () => {
    const failures: string[] = [];
    const off: () => void = eventEmitter.on('outbound-failed', (d: { requestId: string }): number =>
      failures.push(d.requestId),
    );

    outboundQueue.start();
    const id: string = outboundQueue.enqueue({ kind: 'test' });

    // Four windows: three retries, then the give-up.
    for (let i: number = 0; i < 5; i++) {
      vi.advanceTimersByTime(TIMEOUT.SERVER_REQUEST_MS + 1000);
    }

    expect(failures).toContain(id);
    // And it is out of the queue, so it cannot be retried forever.
    expect(outboundQueue.getTimedOut().some((m) => m.requestId === id)).toBe(false);

    off();
  });

  it('stops retrying once acknowledged', () => {
    const retries: string[] = [];
    const off: () => void = eventEmitter.on('outbound-retry', (d: { requestId: string }): number =>
      retries.push(d.requestId),
    );

    outboundQueue.start();
    const id: string = outboundQueue.enqueue({ kind: 'test' });
    outboundQueue.acknowledge(id, { status: 'processed' });

    vi.advanceTimersByTime(TIMEOUT.SERVER_REQUEST_MS * 3);

    expect(retries).not.toContain(id);
    off();
  });
});

describe('it arms itself', () => {
  it('starts polling on the first enqueue, with no caller needed', () => {
    // The tests above pass against a queue nobody ever starts — which is exactly
    // the state this found, and why the arming is self-service rather than a
    // call site someone has to remember.
    expect(outboundQueue.isPolling).toBe(false);

    const id: string = outboundQueue.enqueue({ kind: 'test' });
    expect(outboundQueue.isPolling).toBe(true);

    outboundQueue.acknowledge(id, { status: 'processed' });
  });

  it('stops when the queue drains, so an idle app carries no timer', () => {
    const id: string = outboundQueue.enqueue({ kind: 'test' });
    expect(outboundQueue.isPolling).toBe(true);

    outboundQueue.acknowledge(id, { status: 'processed' });

    expect(outboundQueue.isPolling).toBe(false);
  });
});
