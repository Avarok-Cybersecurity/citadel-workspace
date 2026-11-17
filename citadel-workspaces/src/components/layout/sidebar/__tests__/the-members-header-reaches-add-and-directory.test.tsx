/**
 * Two features that existed with no way in: Add member, and /directory.
 *
 * `MemberManagementModal mode="add"` was rendered by the members section and
 * opened by nothing. `/directory` was routed and linked from nowhere. Both are
 * reached from the members header now: Add member directly, gated on AddUsers
 * for the domain it will name, and the directory through the "find people"
 * dialog it is the full-page form of.
 *
 * Rendered for real. The doubles are I/O boundaries only, as in
 * the-workspace-view-lists-its-members: the member send and its event bus, the
 * peer/conversation hooks (IndexedDB and the agent), the pending-request store,
 * the permission fetch (`usePermission`, agent I/O -- the gate reading it is
 * production code) and discovery's agent queries (`usePeerDiscovery`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider } from '@/components/ui/sidebar';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { Permission } from '@/contexts/PermissionsContext';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import type { UsePermissionResult } from '@/hooks/use-permission-result';

const { permission, asked, conversationsLoaded, registered } = vi.hoisted(() => ({
  registered: { current: [] as unknown[] },
  permission: { current: {} as Partial<UsePermissionResult> },
  conversationsLoaded: { current: true },
  asked: [] as Array<[string | null | undefined, string]>,
}));

vi.mock('@/hooks/use-permission', () => ({
  usePermission: (domainId: string | null | undefined, wanted: string): UsePermissionResult => {
    asked.push([domainId, wanted]);
    return {
      allowed: false, loading: false, reason: null, unanswered: false, answered: true,
      refresh: async (): Promise<void> => {}, ...permission.current,
    };
  },
}));
vi.mock('@/lib/workspace-service', () => ({ default: { listMembers: async (): Promise<void> => {} } }));
vi.mock('@/lib/workspace-events', () => ({
  workspaceEvents: { onMemberEvent: (): (() => void) => (): void => {} },
}));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: (): { state: Record<string, unknown> } => ({
    state: { nodes: {}, currentUser: { username: 'alice' }, workspace: { name: 'Bench' } },
  }),
}));
vi.mock('@/hooks', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  useGroupConversations: (): { groups: never[]; createGroup: () => Promise<string> } =>
    ({ groups: [], createGroup: async (): Promise<string> => '' }),
  useRegisteredPeers: (): { registeredPeers: unknown[] } => ({ registeredPeers: registered.current }),
  useConversationPeers: (): { peersWithConversations: never[]; conversationsLoaded: boolean } => ({ peersWithConversations: [], conversationsLoaded: conversationsLoaded.current }),
  useEventListener: (): void => {},
}));
vi.mock('@/lib/peer-registration-store', () => ({
  peerRegistrationStore: { getPendingCount: async (): Promise<number> => 0, getPendingRequests: async (): Promise<never[]> => [] },
}));
vi.mock('@/components/p2p/usePeerDiscovery', () => ({
  usePeerDiscovery: (): Record<string, unknown> => ({
    peers: [], registeredPeers: new Set(), outgoingRequests: new Set(), incomingRequests: new Map(),
    loading: false, acceptingPeerCid: null, currentCid: 1n, currentUsername: 'alice',
    discoverPeers: async (): Promise<void> => {}, acceptIncomingRequest: async (): Promise<void> => {},
    registerWithPeer: async (): Promise<boolean> => true,
  }),
}));

import { MembersSection } from '../MembersSection';
import { NO_ADD_USERS } from '../add-member-gate';

function renderAt(url: string): void {
  render(
    <MemoryRouter initialEntries={[url]}>
      <TooltipProvider><ConfirmDialogProvider><SidebarProvider>
        <Routes>
          <Route path="/workspace" element={<MembersSection />} />
          <Route path="/directory" element={<p data-testid="directory-page">directory</p>} />
        </Routes>
      </SidebarProvider></ConfirmDialogProvider></TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach((): void => { permission.current = {}; asked.length = 0; conversationsLoaded.current = true; registered.current = []; });

describe('the conversations list', () => {
  it('does not call the list empty before it has been read', () => {
    registered.current = [{ cid: '9', username: 'bob' }];
    conversationsLoaded.current = false;
    renderAt('/workspace');
    expect(screen.queryByText(/No conversations yet/)).toBeNull();
  });

  it('says so once it has been read and is empty', () => {
    registered.current = [{ cid: '9', username: 'bob' }];
    renderAt('/workspace');
    expect(screen.getByText(/No conversations yet/)).toBeTruthy();
  });
});

describe('Add member', () => {
  it('opens the add form for someone whose role permits it', async () => {
    permission.current = { allowed: true };
    renderAt('/workspace');
    fireEvent.click(screen.getByTestId('add-member-button'));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Add New Member');
  });

  it('asks AddUsers of the domain the add will name', () => {
    renderAt('/workspace?nodeId=office-7');
    expect(asked).toContainEqual(['office-7', Permission.AddUsers]);
    renderAt('/workspace');
    expect(asked).toContainEqual([WORKSPACE_ROOT_ID, Permission.AddUsers]);
  });

  it('is disabled with the reason, not hidden, on a known denial', () => {
    permission.current = { reason: 'Requires Add Users on this workspace' };
    renderAt('/workspace');
    const button: HTMLElement = screen.getByTestId('add-member-button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Requires Add Users on this workspace');
  });

  it('falls back to its own reason when the denial carries none', () => {
    renderAt('/workspace');
    expect(screen.getByTestId('add-member-button')).toHaveAttribute('title', NO_ADD_USERS);
  });

  it('stays offered while the answer has not arrived', () => {
    // An unanswered question is not a "no"; the server's refusal will say why.
    permission.current = { answered: false };
    renderAt('/workspace');
    expect(screen.getByTestId('add-member-button')).toBeEnabled();
  });
});

describe('the directory', () => {
  it('is reached from the find-people dialog', async () => {
    renderAt('/workspace');
    fireEvent.click(screen.getByTestId('find-people-button'));
    fireEvent.click(await screen.findByTestId('open-directory-button'));
    await waitFor((): void => { expect(screen.getByTestId('directory-page')).toBeInTheDocument(); });
  });
});
