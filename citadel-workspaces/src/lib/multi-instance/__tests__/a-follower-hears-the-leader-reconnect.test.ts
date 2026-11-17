/**
 * 'on-ws-connection-success' is what re-syncs peers, permissions, the session
 * list and cached messages. Only the leader has a socket, and a follower emitted
 * the event once, at start-up: after the leader's socket was lost and re-opened
 * (agent restart, sleep/wake) every follower tab kept what it had until its own
 * 30 s poll, or for ever. The leader's "socket is up again" report is the
 * follower's reconnect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const role: { isLeader: boolean } = vi.hoisted(() => ({ isLeader: false }));
vi.mock('../instance-manager', () => ({ instanceManager: role }));

import { dispatchChannelMessage } from '../channel-message-dispatch';
import { applyAgentSocketState } from '../agent-socket-state';
import { eventEmitter } from '../../event-emitter';
import type { ChannelMessage } from '../channel-types';
import type { LeaderElectionState } from '../channel-leader-election';

function fromLeader(up: boolean): ChannelMessage {
  return { type: 'agent-socket', targetInstanceId: '*', senderInstanceId: 'leader', timestamp: 0, payload: { up } };
}
function deliver(up: boolean): void {
  dispatchChannelMessage(fromLeader(up), {} as LeaderElectionState, () => {});
}

describe('a follower, when the leader\'s socket comes back', () => {
  let reconnects: number;
  let off: () => void;
  beforeEach(() => {
    role.isLeader = false;
    applyAgentSocketState({ up: true });
    reconnects = 0;
    off = eventEmitter.on('on-ws-connection-success', (): void => { reconnects += 1; });
  });
  afterEach(() => { off(); });

  it('hears a reconnection once per recovery', () => {
    deliver(false);
    expect(reconnects).toBe(0);
    deliver(true);
    expect(reconnects).toBe(1);
  });

  it('hears nothing for a report that changes nothing', () => {
    deliver(true);
    expect(reconnects).toBe(0);
  });
});
