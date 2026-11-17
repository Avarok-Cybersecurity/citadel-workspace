/**
 * A request the user was already told had failed must not be silently re-sent.
 *
 * `sendToLeader` gives up after the ACK timeout and resolves an error — but it
 * never removed the entry from the queue, while the ACK path does call
 * `acknowledge`. `onLeaderChange` replays EVERY queued entry, so a Connect, a
 * workspace mutation or a P2P message that had already surfaced as a failure was
 * re-executed on a later connection, minutes or hours afterwards, and again at
 * every subsequent leader change — because nothing ever removed it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const emitted: Array<{ event: string; payload: unknown }> = [];
vi.mock('@/lib/event-emitter', () => ({
  eventEmitter: {
    emit: (event: string, payload: unknown): number => emitted.push({ event, payload }),
    on: () => (): void => {},
    off: (): void => {},
  },
}));

import { outboundQueue } from '@/lib/multi-instance/outbound-queue';
import type { AckResult } from '@/lib/multi-instance/outbound-queue-types';

describe('the outbound queue', () => {
  beforeEach(() => {
    emitted.length = 0;
    // Drain anything a previous test left behind.
    for (const id of ['r1', 'r2']) outboundQueue.acknowledge(id, { status: 'error' });
  });

  it('replays a still-pending request when the leader changes', () => {
    outboundQueue.enqueue({ kind: 'Connect' }, 'r1');

    outboundQueue.onLeaderChange('new-leader');

    const retries: { event: string; payload: unknown; }[] = emitted.filter((e): boolean => e.event === 'outbound-retry');
    expect(retries).toHaveLength(1);
  });

  it('does NOT replay a request that already failed and was acknowledged', () => {
    outboundQueue.enqueue({ kind: 'Connect' }, 'r2');
    outboundQueue.acknowledge('r2', { status: 'error', error: 'acknowledged' });
    emitted.length = 0;

    outboundQueue.onLeaderChange('new-leader');

    expect(emitted.filter((e) => e.event === 'outbound-retry')).toHaveLength(0);
  });

  /**
   * The test above pins `OutboundQueue.acknowledge`, which was never the broken
   * part. The bug was that `sendToLeader`'s ACK-TIMEOUT path never called it —
   * and the earlier version of this test called `acknowledge` ITSELF, so
   * deleting the production fix left all 41 tests in this directory green.
   * Verified by deleting it: 41 passed.
   *
   * This drives the real `instanceChannel.sendToLeader`, lets the ACK timeout
   * expire with no ack, and then changes leader.
   */
  it('drops a request whose ACK timed out, so a later leader does not re-run it', async () => {
    vi.useFakeTimers();
    try {
      const { instanceChannel } = await import('@/lib/multi-instance/instance-channel');
      const { TIMEOUT } = await import('@/lib/timeout-constants');

      const settled: Promise<AckResult> = instanceChannel.sendToLeader({ kind: 'Connect' }, 'timed-out');

      // Nothing acks. The user is told it failed.
      await vi.advanceTimersByTimeAsync(TIMEOUT.OUTBOUND_ACK_MS + 100);
      await expect(settled).resolves.toMatchObject({ status: 'error' });

      emitted.length = 0;
      outboundQueue.onLeaderChange('new-leader');

      expect(
        emitted.filter((e) => e.event === 'outbound-retry'),
        'a request the user was already told had failed was re-sent to the new leader',
      ).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
