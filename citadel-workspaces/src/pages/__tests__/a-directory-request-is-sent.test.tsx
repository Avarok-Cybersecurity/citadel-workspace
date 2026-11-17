/**
 * The directory's "Send Request" puts a PeerRegister on the wire -- through the
 * discovery dialog's own send, not a second path beside it.
 *
 * It sent through `sendPeerRegistration` directly, with the socket's CID and a
 * request id nobody registered, so a refusal could not be matched back to it.
 * It also offered a message box whose text `PeerRegister` has no field for.
 *
 * The page and `usePeerDiscovery` are driven for real. The doubles are I/O
 * boundaries: the frame send (`sendPeerRegistration`), the agent's discovery
 * queries, the tab's stored selection, IndexedDB, the BroadcastChannel, the
 * member list send, the workspace state the provider fills from the wire, and
 * the toast sink. `AppLayout` is a passthrough: its sidebar is its own socket
 * client and is covered by the members-section tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Peer } from '@/components/p2p/usePeerDiscovery';

const { send, discovered, toast } = vi.hoisted(() => ({
  send: vi.fn(async (): Promise<{ requestId: string; recorded: boolean }> => ({ requestId: 'request-1', recorded: true })),
  toast: vi.fn(),
  discovered: { current: [] as Array<{ cid: string; username: string; is_online: boolean }> },
}));

vi.mock('@/lib/p2p/send-peer-registration', () => ({ sendPeerRegistration: send }));
vi.mock('@/hooks/use-toast', () => ({ useToast: (): { toast: typeof toast } => ({ toast }), toast }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: ReactNode }): JSX.Element => <>{children}</> }));
vi.mock('@/lib/workspace-service', () => ({ default: { listMembers: async (): Promise<void> => {} } }));
vi.mock('@/hooks', () => ({ useRegisteredPeers: (): { registeredPeers: never[] } => ({ registeredPeers: [] }) }));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: (): { state: Record<string, unknown> } => ({
    state: {
      currentUser: { id: 'alice', username: 'alice' },
      workspace: { id: 'workspace-root' },
      members: { bob: { id: 'bob', username: 'bob', displayName: 'Bob', role: 'Member' } },
    },
  }),
}));
vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<{ selectedCid: bigint; selectedUsername: string }> =>
    ({ selectedCid: 1n, selectedUsername: 'alice' }),
}));
vi.mock('@/lib/connection', () => ({
  connectionManager: { getTabSelectedSession: async (): Promise<null> => null, getConnectionInfo: (): null => null },
}));
// Presence is read from lib/presence (the registry of every workspace peer); Bob is
// reported online there although he is not a registered contact.
vi.mock('@/lib/presence', () => ({ isMemberOnline: (id: string): boolean | null => (id === 'bob' ? true : null) }));
vi.mock('@/lib/broadcast-channel-service', () => ({ broadcastChannelService: { registerRequest: vi.fn() } }));
vi.mock('@/lib/peer-registration-store', () => ({
  peerRegistrationStore: {
    getOutgoingRequestCids: async (): Promise<Set<bigint>> => new Set<bigint>(),
    getPendingRequests: async (): Promise<never[]> => [],
  },
}));
vi.mock('@/components/p2p/peer-discovery-requests', () => ({
  fetchAllPeers: async (): Promise<Peer[]> => discovered.current,
  fetchRegisteredPeers: async (): Promise<Set<string>> => new Set<string>(),
  discoverPeersViaGetSessions: async (): Promise<Peer[]> => [],
}));

import { UserDirectory } from '../UserDirectory';
import { eventEmitter } from '@/lib/event-emitter';

function titles(): string[] {
  return toast.mock.calls.map((call: unknown[]): string => (call[0] as { title: string }).title);
}

async function requestBob(): Promise<void> {
  render(<MemoryRouter><UserDirectory /></MemoryRouter>);
  const invite: HTMLElement[] = await screen.findAllByLabelText('Send a connection request to Bob');
  // Discovery resolves asynchronously; the page may send only once it has.
  await waitFor((): void => { expect(titles()).toContain('Peers Discovered'); });
  fireEvent.click(invite[0]);
  fireEvent.click(await screen.findByTestId('send-connection-request'));
}

beforeEach((): void => {
  send.mockClear();
  send.mockImplementation(async (): Promise<{ requestId: string; recorded: boolean }> => ({ requestId: 'request-1', recorded: true }));
  toast.mockClear();
  discovered.current = [{ cid: '2', username: 'bob', is_online: true }];
});

describe('a connection request from the directory', () => {
  it("sends a PeerRegister from this tab's session to the member's CID", async () => {
    await requestBob();
    await waitFor((): void => { expect(send).toHaveBeenCalledTimes(1); });
    const [own, peer, username, requestId] = send.mock.calls[0] as unknown as [bigint, bigint, string, string];
    expect([own, peer, username]).toEqual([1n, 2n, 'bob']);
    // Registered for correlation, which only the shared path does.
    expect(typeof requestId).toBe('string');
    await waitFor((): void => { expect(screen.queryByTestId('send-connection-request')).toBeNull(); });
    expect(titles()).toContain('Request Sent');
  });

  it('keeps the dialog open and says so when the send fails', async () => {
    send.mockRejectedValue(new Error('socket closed'));
    await requestBob();
    await waitFor((): void => { expect(titles()).toContain('Request Failed'); });
    expect(titles()).not.toContain('Request Sent');
    expect(screen.getByTestId('send-connection-request')).toBeInTheDocument();
  });

  it('sends nothing for a member discovery has never seen', async () => {
    discovered.current = [{ cid: '9', username: 'carol', is_online: true }];
    await requestBob();
    await waitFor((): void => { expect(titles()).toContain('Error'); });
    expect(send).not.toHaveBeenCalled();
  });

  it('leaves a recorded request\'s refusal to PeerRefusalNotice: one toast per decline', async () => {
    await requestBob();
    await waitFor((): void => { expect(titles()).toContain('Request Sent'); });
    const requestId: string = (send.mock.calls[0] as unknown as [bigint, bigint, string, string])[3];
    eventEmitter.emit('websocket-message', { PeerRegisterFailure: { request_id: requestId, cid: 1n, message: 'The peer declined the request' } });
    await new Promise((r: (v: void) => void): void => { setTimeout(r, 20); });
    expect(titles()).not.toContain('Request Failed');
  });

  it('still says so itself when the store could not record the request', async () => {
    send.mockImplementation(async (): Promise<{ requestId: string; recorded: boolean }> => ({ requestId: 'request-1', recorded: false }));
    await requestBob();
    await waitFor((): void => { expect(titles()).toContain('Request Sent'); });
    const requestId: string = (send.mock.calls[0] as unknown as [bigint, bigint, string, string])[3];
    eventEmitter.emit('websocket-message', { PeerRegisterFailure: { request_id: requestId, cid: 1n, message: 'The peer declined the request' } });
    await waitFor((): void => { expect(titles()).toContain('Request Failed'); });
  });

  it('lists a non-contact the registry reports online under Online', async () => {
    render(<MemoryRouter><UserDirectory /></MemoryRouter>);
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Online' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Online' }));
    await waitFor((): void => { expect(screen.getByText(/1 online members/i)).toBeInTheDocument(); });
  });

  it('offers no message box the wire cannot carry', async () => {
    await requestBob();
    expect(screen.queryByLabelText(/add a message/i)).toBeNull();
  });
});
