/**
 * A follower that starts holding a session after its P2P link came up is told the link is up.
 *
 * The leader sent `connected-peers-update` once, when the link formed. A follower that
 * loaded later (or switched to that session) missed it and never got another, so its peer
 * read "Offline" over a working connection. Real: the auto-connect service, its
 * connection state, the instance registry and the announce handler. Stood in: which tab
 * leads (there is one tab here) and the BroadcastChannel send (a recorder).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { broadcastChannelService } from '@/lib/broadcast-channel-service';
import { handleInstanceAnnounce } from '@/lib/multi-instance/channel-messaging';
import type { LeaderElectionState } from '@/lib/multi-instance/channel-leader-election';
import { p2pAutoConnectService } from '../index';
import { newlyHeldCid } from '../follower-snapshot';

const FOLLOWER_SESSION: bigint = 14741090851496596846n;
const PEER: bigint = 7610457994796114930n;
const FOLLOWER_TAB: string = '424242';

interface Sent { data: { type?: string; localCid?: string; peerCid?: string; route?: unknown }; about: bigint | undefined }
let sent: Sent[];
let leading: boolean;

beforeEach(() => {
  sent = [];
  leading = true;
  vi.spyOn(instanceManager, 'isLeader', 'get').mockImplementation((): boolean => leading);
  vi.spyOn(broadcastChannelService, 'broadcastStateSync').mockImplementation((data: unknown, about?: bigint): void => {
    sent.push({ data: data as Sent['data'], about });
  });
  instanceManager.unregisterInstance(FOLLOWER_TAB);
  p2pAutoConnectService.setPeerConnected(FOLLOWER_SESSION, PEER);
  sent.length = 0;
});

afterEach(() => { vi.restoreAllMocks(); });

const announceFrom = (instanceId: string, cid: bigint | null): void => {
  const state: LeaderElectionState = { lastLeaderHeartbeat: 0, leaderCheckInterval: null, heartbeatInterval: null, initTime: 0, challenge: null, send: (): void => undefined };
  handleInstanceAnnounce(state, { type: 'instance-announce', targetInstanceId: '*', senderInstanceId: instanceId, timestamp: 0, payload: { cid } });
};

describe('a tab that newly holds a session', () => {
  it('is sent every link that session already has, addressed to it, route field included', () => {
    instanceManager.registerInstance(FOLLOWER_TAB, FOLLOWER_SESSION);
    expect(sent).toHaveLength(1);
    expect(sent[0].about).toBe(FOLLOWER_SESSION);
    expect(sent[0].data).toMatchObject({ type: 'connected-peers-update', localCid: FOLLOWER_SESSION.toString(), peerCid: PEER.toString() });
    expect(sent[0].data).toHaveProperty('route');
  });

  it('is not sent it again for repeating what it already said', () => {
    instanceManager.registerInstance(FOLLOWER_TAB, FOLLOWER_SESSION);
    instanceManager.registerInstance(FOLLOWER_TAB, FOLLOWER_SESSION);
    expect(sent).toHaveLength(1);
  });

  it('is sent it again after reloading, when it announces itself afresh', () => {
    instanceManager.registerInstance(FOLLOWER_TAB, FOLLOWER_SESSION);
    announceFrom(FOLLOWER_TAB, FOLLOWER_SESSION);
    expect(sent).toHaveLength(2);
  });

  it('hears nothing from a tab that does not lead', () => {
    leading = false;
    instanceManager.registerInstance(FOLLOWER_TAB, FOLLOWER_SESSION);
    expect(sent).toEqual([]);
  });
});

describe('what counts as newly held', () => {
  it('a cid that differs from the one before, never this tab and never no session', () => {
    expect(newlyHeldCid({ instanceId: 't', cid: 5n, previous: undefined }, 'me')).toBe(5n);
    expect(newlyHeldCid({ instanceId: 't', cid: 5n, previous: 4n }, 'me')).toBe(5n);
    expect(newlyHeldCid({ instanceId: 't', cid: 5n, previous: 5n }, 'me')).toBeNull();
    expect(newlyHeldCid({ instanceId: 'me', cid: 5n, previous: undefined }, 'me')).toBeNull();
    expect(newlyHeldCid({ instanceId: 't', cid: null, previous: undefined }, 'me')).toBeNull();
  });
});
