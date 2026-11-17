/**
 * A follower has no socket, so it cannot see the leader's go down. Its health
 * check answered "can send" from `!isLeader` alone, and the tab on screen --
 * usually a follower -- showed no banner and no signed-out notice while the
 * agent was gone. The leader now broadcasts the change and followers apply it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const role: { isLeader: boolean } = vi.hoisted(() => ({ isLeader: false }));
vi.mock('../instance-manager', () => ({ instanceManager: role }));

import { dispatchChannelMessage } from '../channel-message-dispatch';
import { isLeaderSocketUp, applyAgentSocketState } from '../agent-socket-state';
import { eventEmitter } from '../../event-emitter';
import type { ChannelMessage } from '../channel-types';
import type { LeaderElectionState } from '../channel-leader-election';

function fromLeader(up: boolean): ChannelMessage {
  return { type: 'agent-socket', targetInstanceId: '*', senderInstanceId: 'leader', timestamp: Date.now(), payload: { up } };
}

describe('the leader\'s socket state reaches followers', () => {
  beforeEach(() => { role.isLeader = false; applyAgentSocketState({ up: true }); });

  it('a follower applies a loss and a recovery, and re-emits each locally', () => {
    const seen: boolean[] = [];
    const off: () => void = eventEmitter.on<{ up: boolean }>('agent-socket-state', ({ up }) => { seen.push(up); });
    dispatchChannelMessage(fromLeader(false), {} as LeaderElectionState, () => {});
    expect(isLeaderSocketUp()).toBe(false);
    dispatchChannelMessage(fromLeader(true), {} as LeaderElectionState, () => {});
    expect(isLeaderSocketUp()).toBe(true);
    expect(seen).toEqual([false, true]);
    off();
  });

  it('a leader ignores another tab\'s report; it knows its own socket', () => {
    role.isLeader = true;
    dispatchChannelMessage(fromLeader(false), {} as LeaderElectionState, () => {});
    expect(isLeaderSocketUp()).toBe(true);
  });

  it('a malformed report changes nothing', () => {
    dispatchChannelMessage({ ...fromLeader(false), payload: { up: 'no' } }, {} as LeaderElectionState, () => {});
    expect(isLeaderSocketUp()).toBe(true);
  });
});
