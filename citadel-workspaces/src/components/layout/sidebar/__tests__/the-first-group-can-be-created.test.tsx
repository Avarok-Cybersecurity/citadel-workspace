/**
 * You must be able to create your FIRST group chat.
 *
 * The only control that opens the create-group dialog lives inside the
 * CONVERSATIONS section, and that whole section was rendered only when
 *
 *   peersWithConversations.length > 0 || groupConversations.length > 0
 *
 * — that is, only once you already had a conversation. A user who had registered
 * peers and had not yet talked to anyone had no way to start a group at all.
 *
 * CI found it as three fresh accounts, P2P registered and accepted on the first
 * attempt, and then:
 *
 *   peergrp_1: Creating group "TestGroup_3" with 2 members...
 *   New Group button not found in sidebar
 *
 * which reads as a missing button and is a missing entry point.
 *
 * Rendered rather than reasoned about: the section is real, the hooks are
 * stubbed at their boundary, and the assertion is on what a person can press.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SidebarProvider } from '@/components/ui/sidebar';
import type { UsePermissionResult } from '@/hooks/use-permission-result';
import { MembersSection } from '../MembersSection';

const peers: { current: { cid: string; username: string; displayName: string; isOnline: boolean; isConnected: boolean }[] } = {
  current: [],
};
const conversations: { current: unknown[] } = { current: [] };
const groups: { current: unknown[] } = { current: [] };

// The members header asks AddUsers through `usePermission`, whose fetch is agent
// I/O and not what this file is about; answered "yes" so the header renders.
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): UsePermissionResult => ({
    allowed: true, loading: false, reason: null, unanswered: false, answered: true,
    refresh: async (): Promise<void> => {},
  }),
}));

vi.mock('@/hooks', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return {
    ...actual,
    useRegisteredPeers: (): unknown => ({ registeredPeers: peers.current }),
    useConversationPeers: (): unknown => ({ peersWithConversations: conversations.current, conversationsLoaded: true }),
    useGroupConversations: (): unknown => ({ groups: groups.current, createGroup: vi.fn() }),
    useEventListener: (): void => undefined,
  };
});
vi.mock('@/hooks/use-domain-members', () => ({
  useDomainMembers: (): unknown => ({ members: [], isLoading: false, reload: vi.fn() }),
}));
vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: (): unknown => ({ state: { nodes: {}, currentUser: { username: 'ada' } } }),
}));
vi.mock('@/lib/peer-registration-store', () => ({
  peerRegistrationStore: { getPendingRequests: async (): Promise<unknown[]> => [] },
}));
vi.mock('@/components/shared/confirm-dialog', () => ({
  useConfirm: (): (() => Promise<boolean>) => async (): Promise<boolean> => true,
}));

async function renderSection(): Promise<void> {
  render(
    <MemoryRouter>
      <SidebarProvider>
        <MembersSection />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

beforeEach((): void => {
  peers.current = [];
  conversations.current = [];
  groups.current = [];
});

describe('the new-group-chat control', () => {
  it('is there for somebody with peers and no conversations yet', async (): Promise<void> => {
    peers.current = [{ cid: '42', username: 'bob', displayName: 'bob', isOnline: true, isConnected: true }];
    await renderSection();

    expect(screen.getByTestId('new-group-chat-button')).toBeInTheDocument();
  });

  it('is still there once conversations exist', async (): Promise<void> => {
    // The positive control: the case that always worked must keep working, or
    // the assertion above could be satisfied by a button that is now always on.
    peers.current = [{ cid: '42', username: 'bob', displayName: 'bob', isOnline: true, isConnected: true }];
    conversations.current = [
      { peerCid: '42', peerUsername: 'bob', peerDisplayName: 'bob', isOnline: true, isConnected: true, unreadCount: 0 },
    ];
    await renderSection();

    expect(screen.getByTestId('new-group-chat-button')).toBeInTheDocument();
  });

  it('is absent when there is nobody to put in a group', async (): Promise<void> => {
    // Not merely hidden-when-empty for its own sake: a create-group dialog with
    // no peers to add is a dead end, and offering it is worse than not.
    await renderSection();

    expect(screen.queryByTestId('new-group-chat-button')).not.toBeInTheDocument();
  });
});
