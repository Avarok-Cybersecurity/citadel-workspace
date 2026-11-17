/**
 * A peer is ADDRESSED by username and SHOWN by display name.
 *
 * Once the roster taught `peerDisplayName` that bob0924 is "Bob Brown", the
 * peer hooks wrote that display name into their `username` field, so the
 * sidebar row became `data-testid="peer-row-Bob Brown"`, its DM route carried
 * "Bob Brown" as the username, and every username lookup (the directory, the
 * group dialog's members) missed.
 *
 * Mocked: the agent reads (registered peers, presence, current CID) and the
 * messenger's conversation store -- I/O this hook routes through services.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { recordMemberNames } from '@/lib/member-names';
import { rosterPeerName } from '@/lib/roster-peer-name';

vi.mock('@/lib/p2p/current-cid', () => ({ getCurrentCid: async (): Promise<bigint> => 7n }));
vi.mock('@/lib/p2p', () => ({
  P2PMessengerManager: {
    getInstance: (): { getAllConversations: () => unknown[]; cleanupStaleConversations: () => Promise<number> } => ({
      getAllConversations: (): unknown[] => [{ peerCid: 1000n, messages: [{ timestamp: 1 }], unreadCount: 0 }],
      cleanupStaleConversations: async (): Promise<number> => 0,
    }),
  },
}));
vi.mock('@/lib/connection', () => ({ connectionManager: { getConnectionInfo: (): { cid: bigint } => ({ cid: 7n }) } }));
vi.mock('@/lib/p2p-registration-service', () => ({
  p2pRegistrationService: {
    getPeers: (): { registeredPeers: unknown[]; allPeers: unknown[] } => ({ registeredPeers: [], allPeers: [] }),
    listRegisteredPeersWithRetry: async (): Promise<{ cid: bigint; username: string }[]> => [{ cid: 1000n, username: 'bob0924' }],
  },
}));
vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: {
    peerOnlineStatus: (): boolean => true,
    isPeerConnected: async (): Promise<boolean> => true,
    isPeerConnectedForSession: (): boolean => true,
    getConnectedPeers: async (): Promise<bigint[]> => [],
    getPeerConnectionInfo: (): null => null,
  },
}));
vi.mock('@/lib/session-startup-service', () => ({ sessionStartupService: { isStartupInProgress: (): boolean => true } }));

import { useRegisteredPeers, type RegisteredPeer } from '../use-registered-peers';
import { useConversationPeers } from '../use-conversation-peers';
import { PeerListRow } from '@/components/layout/sidebar/PeerListRow';
import { SidebarProvider } from '@/components/ui/sidebar';

recordMemberNames([{ id: 'bob0924', displayName: 'Bob Brown' }]);

describe('a registered peer', () => {
  it('keeps its username and carries the roster name beside it', async () => {
    const { result } = renderHook(() => useRegisteredPeers());
    await waitFor(() => expect(result.current.registeredPeers).toHaveLength(1));
    const peer: RegisteredPeer = result.current.registeredPeers[0];
    expect(peer.username).toBe('bob0924');
    expect(peer.displayName).toBe('Bob Brown');
  });

  it('is named by CID-only surfaces (calls, groups) as the sidebar names it', async () => {
    const { result } = renderHook(() => useRegisteredPeers());
    await waitFor(() => expect(result.current.registeredPeers).toHaveLength(1));
    // The registration cache is empty (fresh browser); the agent's listing is what names them.
    expect(rosterPeerName(1000n)).toBe('Bob Brown');
  });
});

describe('a conversation peer', () => {
  it('keeps its username and carries the roster name beside it', async () => {
    const registeredPeers: RegisteredPeer[] = [
      { cid: '1000', username: 'bob0924', displayName: 'Bob Brown', isOnline: true, isConnected: true, connectionPath: null },
    ];
    const { result } = renderHook(() => useConversationPeers({ registeredPeers }));
    await waitFor(() => expect(result.current.peersWithConversations).toHaveLength(1));
    expect(result.current.peersWithConversations[0].peerUsername).toBe('bob0924');
    expect(result.current.peersWithConversations[0].peerDisplayName).toBe('Bob Brown');
  });
});

describe('a sidebar peer row', () => {
  it('is addressed by username and shows the display name', () => {
    render(
      <SidebarProvider>
        <PeerListRow cid="1000" username="bob0924" displayName="Bob Brown" isOnline isConnected connectionPath={null} onClick={vi.fn()} />
      </SidebarProvider>,
    );
    expect(screen.getByTestId('peer-row-bob0924')).toHaveTextContent('Bob Brown');
    expect(screen.queryByTestId('peer-row-Bob Brown')).toBeNull();
  });
});
