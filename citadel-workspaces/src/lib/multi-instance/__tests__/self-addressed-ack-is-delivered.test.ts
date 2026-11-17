/**
 * A tab can be the leader answering ITS OWN queued request: after a leader dies,
 * a follower holding a pending entry wins the election and the replay executes
 * locally instead of being posted.
 *
 * The ack for that went out over BroadcastChannel — which never delivers a
 * message to the posting context — so it vanished. The queue entry survived,
 * `checkTimeouts` re-fired it every 5s, and each retry RE-EXECUTED the request:
 * a Connect, a workspace mutation or a P2P message run up to four times, then
 * reported as failed when the caller's own 30s timer expired.
 */
import { describe, it, expect, vi, beforeEach   } from 'vitest';

const posted: unknown[] = [];
vi.mock('@/lib/event-emitter', () => ({
  eventEmitter: { emit: (): void => {}, on: () => (): void => {}, off: (): void => {} },
}));

import { instanceManager } from '../instance-manager';
import { instanceChannel } from '../instance-channel';
import { outboundQueue } from '../outbound-queue';

describe('a self-addressed ack', () => {
  beforeEach(() => { posted.length = 0; });

  it('settles the queue entry instead of being posted into the void', async () => {
    const id: "self-ack-1" = 'self-ack-1';
    outboundQueue.enqueue({ kind: 'Connect' }, id);

    // The leader answering its own replayed request.
    instanceChannel.sendAck(instanceManager.instanceId, id, { status: 'processed' });

    // Still queued means the retry timer will re-execute the request.
    outboundQueue.onLeaderChange('someone-else');
    expect(
      outboundQueue.getPending?.().some?.((e: { requestId: string }) => e.requestId === id) ?? false,
      'the entry survived its own ack, so the request will be executed again',
    ).toBe(false);
  });

  it('still posts an ack addressed to a different tab', () => {
    const send: ReturnType<typeof vi.spyOn> = vi.spyOn(instanceChannel, 'send' as never);
    instanceChannel.sendAck('another-tab', 'r-other', { status: 'processed' });
    expect(send).toHaveBeenCalled();
    send.mockRestore();
  });
});
