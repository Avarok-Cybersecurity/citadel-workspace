/**
 * A follower asks the leader what its agent offers, and kept the answer for
 * the life of the page. The leader forgets and declares again on every socket;
 * when the leader's socket was lost (an agent restarted into another version,
 * or one that does not host messaging), a follower still acted on the old
 * agent's answer. It must ask again once the socket is gone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const role: { isLeader: boolean } = vi.hoisted(() => ({ isLeader: false }));
vi.mock('@/lib/multi-instance/instance-manager', () => ({ instanceManager: role }));

import { registerCapabilityRoute, agentHostsConversations, forgetCapabilities, type LeaderAnswer } from '../capabilities';
import { dispatchChannelMessage } from '@/lib/multi-instance/channel-message-dispatch';
import { applyAgentSocketState } from '@/lib/multi-instance/agent-socket-state';
import type { ChannelMessage } from '@/lib/multi-instance/channel-types';
import type { LeaderElectionState } from '@/lib/multi-instance/channel-leader-election';

function leaderSays(up: boolean): void {
  const message: ChannelMessage = { type: 'agent-socket', targetInstanceId: '*', senderInstanceId: 'leader', timestamp: 0, payload: { up } };
  dispatchChannelMessage(message, {} as LeaderElectionState, () => {});
}

describe('a follower\'s cached answer about the agent', () => {
  let answers: boolean[];
  beforeEach(() => {
    role.isLeader = false;
    forgetCapabilities();
    applyAgentSocketState({ up: true });
    answers = [true, false];
    registerCapabilityRoute({
      isLeader: (): boolean => role.isLeader,
      askLeader: async (): Promise<LeaderAnswer> => ({ agentIlm: answers.shift() ?? false, supervisesP2p: false, stagesUploads: false, takesConsole: false, servesApps: false, noticesHeard: false }),
    });
  });

  it('is kept while the leader\'s socket stays up', async () => {
    expect(await agentHostsConversations()).toBe(true);
    expect(await agentHostsConversations()).toBe(true);
  });

  it('is asked for again after the leader\'s socket was lost', async () => {
    expect(await agentHostsConversations()).toBe(true);
    leaderSays(false);
    leaderSays(true);
    expect(await agentHostsConversations()).toBe(false);
  });
});
