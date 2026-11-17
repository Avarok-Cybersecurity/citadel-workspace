/**
 * The poll read a peer listed with no online status as `false`, so a person the
 * backend had said nothing about was reported offline: the word the presence
 * type exists to avoid asserting.
 *
 * Real: the poll and the connection-state core. Stood in: the registry's list
 * (network I/O), through a spy.
 */
import { describe, it, expect, vi } from 'vitest';
import { p2pRegistrationService } from '@/lib/p2p-registration-service';
import { AutoConnectState } from '../state';
import { refreshOnlineStatus } from '../polling';
import type { PeerInfoResponse } from '@/lib/p2p-registration-service/types';

const ON: bigint = 1n;
const OFF: bigint = 2n;
const SILENT: bigint = 3n;

describe('refreshOnlineStatus', () => {
  it('keeps online, offline and unreported apart', async () => {
    const listed: PeerInfoResponse[] = [
      { cid: ON, online_status: true },
      { cid: OFF, online_status: false },
      { cid: SILENT },
    ] as PeerInfoResponse[];
    vi.spyOn(p2pRegistrationService, 'listAllPeers').mockResolvedValue(listed);
    const state: AutoConnectState = new AutoConnectState();

    await refreshOnlineStatus(state, true);

    expect(state.peerOnlineStatus(ON)).toBe(true);
    expect(state.peerOnlineStatus(OFF)).toBe(false);
    expect(state.peerOnlineStatus(SILENT)).toBeNull();
  });
});
