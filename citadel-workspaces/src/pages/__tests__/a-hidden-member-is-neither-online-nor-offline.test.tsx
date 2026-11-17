/**
 * Directory -> Online, for a member who turned Online Status off.
 *
 * Live (2026-09-25): max.lab had it off, yet a member who was not his contact
 * saw him "Online now" here, because the server's peer list reports presence to
 * everyone. He is now listed under All as "Presence not known" -- not under
 * Online, and not as offline.
 *
 * The page, lib/presence and the response handler that records the published
 * choice are real. The doubles are the I/O boundaries the sibling
 * a-directory-request-is-sent test names, plus the peer registry and the
 * auto-connect service, which hold what the agent last reported.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';

// Stable, as the real hook's is: discovery re-runs whenever `toast` changes identity.
const { toast } = vi.hoisted(() => ({ toast: (): void => {} }));
vi.mock('@/hooks/use-toast', () => ({ useToast: (): { toast: () => void } => ({ toast }), toast }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: ReactNode }): JSX.Element => <>{children}</> }));
vi.mock('@/lib/workspace-service', () => ({ default: { listMembers: async (): Promise<void> => {} } }));
vi.mock('@/hooks', () => ({ useRegisteredPeers: (): { registeredPeers: never[] } => ({ registeredPeers: [] }) }));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: (): { state: Record<string, unknown> } => ({
    state: {
      currentUser: { id: 'alice', username: 'alice' },
      workspace: { id: 'workspace-root' },
      members: { max: { id: 'max', username: 'max', displayName: 'Max Lab', role: 'Member' } },
    },
  }),
}));
vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<{ selectedCid: bigint; selectedUsername: string }> => ({ selectedCid: 1n, selectedUsername: 'alice' }),
}));
vi.mock('@/lib/connection', () => ({
  connectionManager: { getTabSelectedSession: async (): Promise<null> => null, getConnectionInfo: (): null => null },
}));
vi.mock('@/lib/broadcast-channel-service', () => ({ broadcastChannelService: { registerRequest: vi.fn() } }));
vi.mock('@/lib/peer-registration-store', () => ({
  peerRegistrationStore: { getOutgoingRequestCids: async (): Promise<Set<bigint>> => new Set<bigint>(), getPendingRequests: async (): Promise<never[]> => [] },
}));
vi.mock('@/components/p2p/peer-discovery-requests', () => ({
  fetchAllPeers: async (): Promise<never[]> => [],
  fetchRegisteredPeers: async (): Promise<Set<string>> => new Set<string>(),
  discoverPeersViaGetSessions: async (): Promise<never[]> => [],
}));
// The agent reports Max connected; he is not a contact and no P2P link is up.
vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: { peerOnlineStatus: (): boolean => true, isPeerConnectedForSession: (): boolean => false },
}));
vi.mock('@/lib/p2p-registration-service', () => ({
  p2pRegistrationService: {
    getPeers: (): unknown => ({ allPeers: [{ cid: 42n, username: 'max', fullName: 'Max Lab', isOnline: true, isRegistered: false }], registeredPeers: [] }),
  },
}));

import { UserDirectory } from '../UserDirectory';
import { handleGeneratedVariants } from '@/lib/workspace-response-handler/generated-variant-handlers';
import type { ConnectionInfo } from '@/lib/workspace-response-handler/workspace-handlers';

function maxPublishes(shows: boolean): void {
  const response: unknown = {
    Members: { domain_id: null, members: [{ id: 'max', name: 'Max Lab', role: 'Member', permissions: {}, metadata: { shows_online_status: { type: 'Boolean', content: shows } } }] },
  };
  handleGeneratedVariants(response as WorkspaceProtocolResponse, { request_id: 'r' } as unknown as ConnectionInfo);
}

async function openOnlineTab(): Promise<void> {
  fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Online' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Online' }));
}

describe('a member who turned Online Status off', () => {
  it('is listed as not known, and not under Online', async () => {
    maxPublishes(false);
    render(<MemoryRouter><UserDirectory /></MemoryRouter>);
    expect(await screen.findByText('Presence not known')).toBeInTheDocument();
    expect(screen.queryByText('Online now')).toBeNull();
    expect(screen.queryByText(/last seen|offline/i)).toBeNull();
    await openOnlineTab();
    await waitFor((): void => { expect(screen.getByText(/Presence isn't known yet for 1 of 1/i)).toBeInTheDocument(); });
    expect(screen.queryByText(/1 online members/i)).toBeNull();
  });

  it('is online again once they turn it back on', async () => {
    maxPublishes(true);
    render(<MemoryRouter><UserDirectory /></MemoryRouter>);
    await openOnlineTab();
    await waitFor((): void => { expect(screen.getByText(/1 online members/i)).toBeInTheDocument(); });
  });
});
