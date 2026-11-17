/**
 * A follower tab signed in as somebody else learns the state of ITS connections.
 *
 * Seen live (bench): the leader tab (carol) connected erin's session to carol's, a file
 * crossed the link byte for byte, and erin's follower tab still read carol as "Offline".
 * Two defects, both here:
 *
 * 1. The leader's connected-peers-update was addressed to the leader's own session
 *    (broadcastStateSync stamped the sender tab's selection), and followers drop
 *    state-sync addressed to another session — so erin's tab discarded the one message
 *    that said her link was up.
 * 2. Resetting connection state on login dated an EMPTY online set as a completed poll.
 *    Followers never poll, so every peer read a confident "Offline" for the tab's life.
 *
 * Real: the targeting rule, the envelope builder, the connection-state core. Stood in:
 * the BroadcastChannel (a recorder), because there is no second tab here.
 */
import { describe, it, expect, vi } from 'vitest';
import { broadcastStateSync, stateSyncTarget } from '@/lib/broadcast-channel-service/broadcasting';
import { AutoConnectState } from '../state';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { broadcastChannelService } from '@/lib/broadcast-channel-service';
import { p2pAutoConnectService } from '../index';

const LEADER_SESSION: bigint = 7610457994796114930n;
const FOLLOWER_SESSION: bigint = 14741090851496596846n;

describe('a state-sync about a follower session', () => {
  it('is addressed to that session, not to the leader tab session', () => {
    expect(stateSyncTarget(FOLLOWER_SESSION, LEADER_SESSION)).toBe(FOLLOWER_SESSION);
    expect(stateSyncTarget(undefined, LEADER_SESSION)).toBe(LEADER_SESSION);
    expect(stateSyncTarget(undefined, undefined)).toBeUndefined();
  });

  it('goes out with that session on the envelope', () => {
    const posted: Array<{ targetCid?: bigint }> = [];
    const channel: BroadcastChannel = { postMessage: (m: { targetCid?: bigint }): void => { posted.push(m); } } as unknown as BroadcastChannel;
    broadcastStateSync(channel, 'leader-tab', true, { type: 'connected-peers-update', localCid: FOLLOWER_SESSION.toString(), peerCid: LEADER_SESSION.toString() },
      stateSyncTarget(FOLLOWER_SESSION, LEADER_SESSION));
    expect(posted).toHaveLength(1);
    expect(posted[0].targetCid).toBe(FOLLOWER_SESSION);
  });
});

describe('resetting connection state', () => {
  it('forgets presence rather than reporting everybody offline', () => {
    const state: AutoConnectState = new AutoConnectState();
    state.setOnlinePeers([LEADER_SESSION], []);
    expect(state.peerOnlineStatus(LEADER_SESSION)).toBe(true);
    state.clearOnlineStatus();
    expect(state.peerOnlineStatus(LEADER_SESSION)).toBeNull();
  });

  it('still reports offline after a real poll that did not list the peer', () => {
    const state: AutoConnectState = new AutoConnectState();
    state.setOnlinePeers([], []);
    expect(state.peerOnlineStatus(LEADER_SESSION)).toBe(false);
  });
});

describe('the leader, marking a follower session connected', () => {
  it('addresses the update to that session', async () => {
    vi.spyOn(instanceManager, 'isLeader', 'get').mockReturnValue(true);
    const sent: Array<{ data: unknown; about: bigint | undefined }> = [];
    vi.spyOn(broadcastChannelService, 'broadcastStateSync').mockImplementation((data: unknown, about?: bigint): void => { sent.push({ data, about }); });
    p2pAutoConnectService.setPeerConnected(FOLLOWER_SESSION, LEADER_SESSION);
    expect(sent).toHaveLength(1);
    expect(sent[0].about).toBe(FOLLOWER_SESSION);
    vi.restoreAllMocks();
  });
});
