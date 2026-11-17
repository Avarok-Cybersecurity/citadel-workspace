/**
 * Only the leader tab owns a socket, so only the leader hears 'websocket-disconnected'.
 * A follower's request is carried over the leader's socket; when that socket was lost
 * (an agent restart) the follower's request waited out its whole budget -- 30 s to
 * 120 s -- over a connection that was gone. What a follower hears is the leader's
 * report (agent-socket-state), and a lost socket there must end its waits too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const role: { isLeader: boolean } = vi.hoisted(() => ({ isLeader: false }));
vi.mock('@/lib/multi-instance/instance-manager', () => ({ instanceManager: role }));

import { requestResponse, requestResponseSoft, failOnSocketLoss } from '../request-response';
import { dispatchChannelMessage } from '@/lib/multi-instance/channel-message-dispatch';
import { applyAgentSocketState } from '@/lib/multi-instance/agent-socket-state';
import type { ChannelMessage } from '@/lib/multi-instance/channel-types';
import type { LeaderElectionState } from '@/lib/multi-instance/channel-leader-election';

const never: { matchSuccess: () => undefined; matchFailure: () => undefined } = { matchSuccess: (): undefined => undefined, matchFailure: (): undefined => undefined };

function leaderReports(up: boolean): void {
  const message: ChannelMessage = { type: 'agent-socket', targetInstanceId: '*', senderInstanceId: 'leader', timestamp: 0, payload: { up } };
  dispatchChannelMessage(message, {} as LeaderElectionState, () => {});
}

beforeEach(() => { role.isLeader = false; applyAgentSocketState({ up: true }); });

describe('a follower\'s pending request', () => {
  it('fails when the leader reports its socket lost', async () => {
    const pending: Promise<string> = requestResponse<string>({
      request: {}, requestId: 'f1', sendRequest: async () => {}, timeoutMs: 60_000, operationName: 'ListAllPeers', matcher: never,
    });
    await Promise.resolve();
    leaderReports(false);
    await expect(pending).rejects.toThrow(/ListAllPeers failed: the connection to the Citadel agent was lost/);
  });

  it('is released by the soft variant too', async () => {
    const failures: string[] = [];
    const pending: Promise<void> = requestResponseSoft({
      request: {}, requestId: 'f2', sendRequest: async () => {}, timeoutMs: 60_000, operationName: 'AcceptPeer',
      matchSuccess: () => false, matchFailure: () => undefined, onFailure: (e: string) => { failures.push(e); },
    });
    await Promise.resolve();
    leaderReports(false);
    await pending;
    expect(failures.join()).toMatch(/lost/);
  });

  it('fails a hand-rolled wait wrapped in failOnSocketLoss', async () => {
    const wrapped: Promise<void> = failOnSocketLoss('SendFile', new Promise<void>(() => {}));
    leaderReports(false);
    await expect(wrapped).rejects.toThrow(/SendFile failed/);
  });

  it('is left alone when the leader reports its socket up', async () => {
    const settled: string[] = [];
    void failOnSocketLoss('X', new Promise<void>(() => {})).then(() => settled.push('ok'), () => settled.push('failed'));
    leaderReports(true);
    await Promise.resolve();
    expect(settled).toEqual([]);
  });
});
