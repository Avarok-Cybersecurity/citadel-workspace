/**
 * Only the leader has a socket, so only it hears the agent say its notifier
 * came or went (NoticesHeardNotification). A follower raises OS notifications
 * for its own session's messages, so it must hear it too: the leader passes it
 * on, and the follower applies it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const role: { isLeader: boolean } = vi.hoisted(() => ({ isLeader: false }));
vi.mock('../instance-manager', () => ({ instanceManager: role }));

import { dispatchChannelMessage } from '../channel-message-dispatch';
import { installNoticesHeardRelay } from '../notices-heard-relay';
import { noticesHeard } from '@/lib/agent-conversations/capabilities';
import { createValueStore, type ValueStore } from '@/lib/value-store';
import type { ChannelMessage } from '../channel-types';
import type { LeaderElectionState } from '../channel-leader-election';

function fromLeader(payload: unknown): ChannelMessage {
  return { type: 'notices-heard', targetInstanceId: '*', senderInstanceId: 'leader', timestamp: 0, payload };
}

beforeEach(() => { role.isLeader = false; noticesHeard.set(false); });

describe('the leader', () => {
  it('passes every change on', () => {
    role.isLeader = true;
    const store: ValueStore<boolean> = createValueStore<boolean>('test-heard', false);
    const sent: boolean[] = [];
    installNoticesHeardRelay({ store, isLeader: () => role.isLeader, send: (heard: boolean): void => { sent.push(heard); } });
    store.set(true);
    store.set(false);
    expect(sent).toEqual([true, false]);
  });

  it('a follower passes nothing on: what it holds came from the leader', () => {
    const store: ValueStore<boolean> = createValueStore<boolean>('test-heard', false);
    const sent: boolean[] = [];
    installNoticesHeardRelay({ store, isLeader: () => role.isLeader, send: (heard: boolean): void => { sent.push(heard); } });
    store.set(true);
    expect(sent).toEqual([]);
  });
});

describe('a follower', () => {
  it('applies what the leader passes on', () => {
    dispatchChannelMessage(fromLeader({ heard: true }), {} as LeaderElectionState, () => {});
    expect(noticesHeard.get()).toBe(true);
    dispatchChannelMessage(fromLeader({ heard: false }), {} as LeaderElectionState, () => {});
    expect(noticesHeard.get()).toBe(false);
  });

  it('ignores a malformed one', () => {
    dispatchChannelMessage(fromLeader({ heard: 'yes' }), {} as LeaderElectionState, () => {});
    expect(noticesHeard.get()).toBe(false);
  });
});

describe('the leader, hearing another tab', () => {
  it('keeps what its own socket told it', () => {
    role.isLeader = true;
    dispatchChannelMessage(fromLeader({ heard: true }), {} as LeaderElectionState, () => {});
    expect(noticesHeard.get()).toBe(false);
  });
});
