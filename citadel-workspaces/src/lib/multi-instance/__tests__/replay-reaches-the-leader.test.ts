/**
 * A replayed request must reach the leader even when the leader is us.
 *
 * `BroadcastChannel.postMessage` never delivers to the posting context, and the
 * inbound path filters self-traffic on top of that — so a tab that owned queued
 * requests and then WON the election posted them to 'leader' and addressed
 * nobody. The recovery described in the retry subscription's comment only worked
 * when some other tab won.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let isLeader: boolean = false;
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, {
    get isLeader(): boolean {
      return isLeader;
    },
    instanceId: 'me',
  }) };
});

const emitted: string[] = [];
vi.mock('@/lib/event-emitter', () => ({
  eventEmitter: {
    emit: (event: string): number => emitted.push(event),
    on: () => (): void => {},
    off: (): void => {},
  },
}));

import { replayOutboundRequest } from '@/lib/multi-instance/channel-messaging';

/** The leader's local path emits this; a lost replay emits nothing. */
const LOCAL: "channel:outbound-request" = 'channel:outbound-request';

beforeEach(() => {
  emitted.length = 0;
});

describe('replaying a queued request', () => {
  it('posts on the channel when another tab is leader', () => {
    isLeader = false;
    const sent: unknown[] = [];

    replayOutboundRequest('r1', { kind: 'Connect' }, (m) => sent.push(m));

    expect(sent).toHaveLength(1);
    expect(emitted).not.toContain(LOCAL);
  });

  it('dispatches locally when WE are the new leader', () => {
    isLeader = true;
    const sent: unknown[] = [];

    replayOutboundRequest('r2', { kind: 'Connect' }, (m) => sent.push(m));

    // Posting here would address nobody: the channel does not echo to its own
    // sender, so the request would be lost exactly when recovery matters most.
    expect(sent, 'posted to a channel that cannot deliver to us').toHaveLength(0);
    expect(emitted).toContain(LOCAL);
  });
});
