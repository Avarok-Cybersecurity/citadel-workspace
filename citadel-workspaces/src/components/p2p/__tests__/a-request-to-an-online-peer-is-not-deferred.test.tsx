/**
 * "They will receive it when online" was said to every peer.
 *
 * Seen on the live site: the discovery list showed the peer Online, and sending
 * a connection request toasted "Connection request sent to X. They will receive
 * it when online." -- telling the user to wait for something the same screen
 * said had already happened. The note is only true for a peer who is offline or
 * whose presence the agent has not reported.
 *
 * The hook is driven for real. The doubles are its I/O boundaries only: the
 * agent requests (discovery, registration send), the tab's stored selection,
 * the IndexedDB request store, the BroadcastChannel, and the toast sink, which
 * is where the answer is read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Peer } from '../usePeerDiscovery';

const toast: ReturnType<typeof vi.fn> = vi.fn();
let discovered: Peer[] = [];

vi.mock('@/hooks/use-toast', () => ({ useToast: (): { toast: typeof toast } => ({ toast }) }));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: (): { state: { currentUser: null } } => ({ state: { currentUser: null } }),
}));
vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<{ selectedCid: bigint; selectedUsername: string }> =>
    ({ selectedCid: 1n, selectedUsername: 'alice' }),
}));
vi.mock('@/lib/connection', () => ({
  connectionManager: { getTabSelectedSession: async (): Promise<null> => null, getConnectionInfo: (): null => null },
}));
vi.mock('@/lib/broadcast-channel-service', () => ({ broadcastChannelService: { registerRequest: vi.fn() } }));
vi.mock('@/lib/p2p/send-peer-registration', () => ({ sendPeerRegistration: vi.fn(async (): Promise<{ requestId: string; recorded: boolean }> => ({ requestId: 'r', recorded: true })) }));
vi.mock('@/lib/peer-registration-store', () => ({
  peerRegistrationStore: {
    getOutgoingRequestCids: async (): Promise<Set<bigint>> => new Set<bigint>(),
    getPendingRequests: async (): Promise<never[]> => [],
  },
}));
vi.mock('../peer-discovery-requests', () => ({
  fetchAllPeers: async (): Promise<Peer[]> => discovered,
  fetchRegisteredPeers: async (): Promise<Set<string>> => new Set<string>(),
  discoverPeersViaGetSessions: async (): Promise<Peer[]> => [],
}));

import { usePeerDiscovery } from '../usePeerDiscovery';
import { connectionRequestSentCopy } from '../connection-request-copy';

function sentDescriptions(): string[] {
  return toast.mock.calls
    .map((call: unknown[]): { title?: string; description?: string } => call[0] as { title?: string; description?: string })
    .filter((arg: { title?: string }): boolean => arg.title === 'Request Sent')
    .map((arg: { description?: string }): string => arg.description ?? '');
}

async function sendTo(peer: Peer, announce: boolean = true): Promise<string[]> {
  discovered = [peer];
  const { result } = renderHook(() => usePeerDiscovery(true));
  await waitFor((): void => { expect(result.current.peers).toEqual([peer]); });
  await act(async (): Promise<void> => { await result.current.registerWithPeer(peer.cid, peer.username, announce); });
  return sentDescriptions();
}

beforeEach((): void => { toast.mockClear(); });

describe('the connection-request confirmation', () => {
  it('does not tell the user to wait for a peer shown online', async () => {
    const sent: string[] = await sendTo({ cid: '2', username: 'bob', is_online: true });
    expect(sent).toEqual(['Connection request sent to bob.']);
  });

  it('keeps the note for a peer who is offline', async () => {
    const sent: string[] = await sendTo({ cid: '3', username: 'carol', is_online: false });
    expect(sent).toEqual(['Connection request sent to carol. They will receive it when online.']);
  });

  it('says nothing for the request a trusted chat sends on open', async () => {
    const sent: string[] = await sendTo({ cid: '4', username: 'erin', is_online: true }, false);
    expect(sent).toEqual([]);
  });
});

describe('the copy the User Directory shares', () => {
  it('keeps the note when the agent has not reported presence', () => {
    // null is "not said", not "online": promising nothing is the honest answer.
    expect(connectionRequestSentCopy('dave', null)).toBe('Connection request sent to dave. They will receive it when online.');
    expect(connectionRequestSentCopy('dave', true)).toBe('Connection request sent to dave.');
  });
});
