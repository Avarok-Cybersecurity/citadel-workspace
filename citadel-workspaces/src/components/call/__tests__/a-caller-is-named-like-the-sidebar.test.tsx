/**
 * A call names people as the sidebar does.
 *
 * Live, in bob's fresh browser, alice's call rang as "Peer 6W1TP1" on the card
 * and the tile, beside a sidebar row reading "Alice Anders": the call asked the
 * registration cache, which only registrations seen in THIS tab fill, while the
 * sidebar lists what the agent reports. The agent's list is now what a CID-only
 * lookup falls back to, and a real username is shown as its roster full name.
 *
 * Mocked: the registration cache -- empty, as in a fresh browser.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { eventEmitter } from '@/lib/event-emitter';
import { recordMemberNames, recordPeerUsernames } from '@/lib/member-names';

vi.mock('@/lib/p2p-registration-service', () => ({
  p2pRegistrationService: { getPeers: (): unknown => ({ registeredPeers: [], allPeers: [] }) },
}));

import { useRosterName } from '../use-roster-name';
import { rosterPeerName } from '@/lib/roster-peer-name';
import { peerDisplayName } from '@/lib/peer-display';

const ALICE: bigint = 14768729968876999829n;
recordMemberNames([{ id: 'alice0924', displayName: 'Alice Anders' }]);

describe('a caller', () => {
  it('frozen as a handle is named once the sidebar has listed them', () => {
    const handle: string = peerDisplayName({ cid: ALICE });
    const { result } = renderHook(() => useRosterName(ALICE, handle));
    expect(result.current).toBe(handle);

    act((): void => {
      recordPeerUsernames([{ cid: ALICE, username: 'alice0924' }]);
      eventEmitter.emit('p2p:peer-names-learned', {});
    });
    expect(result.current).toBe('Alice Anders');
    expect(rosterPeerName(ALICE)).toBe('Alice Anders');
  });

  it('frozen as a username is shown by their roster full name', () => {
    const { result } = renderHook(() => useRosterName(ALICE, 'alice0924'));
    expect(result.current).toBe('Alice Anders');
  });
});
