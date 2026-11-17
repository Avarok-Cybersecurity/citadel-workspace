/**
 * Creating a group opens it.
 *
 * It used to close the dialog and leave you where you were, with a new row
 * somewhere in the sidebar -- an action whose only evidence was a list you were
 * not looking at. Every other way into a group navigates; this one did not, and
 * `peer-group`'s first check waits thirty seconds for `/groups/:id` before
 * falling back to that row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SidebarProvider } from '@/components/ui/sidebar';
import type { UsePermissionResult } from '@/hooks/use-permission-result';
import { MembersSection } from '../MembersSection';

const navigated: string[] = [];
const createGroup: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<string> => 'group-77');

// The members header asks AddUsers through `usePermission`, whose fetch is agent
// I/O and not what this file is about; answered "yes" so the header renders.
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): UsePermissionResult => ({
    allowed: true, loading: false, reason: null, unanswered: false, answered: true,
    refresh: async (): Promise<void> => {},
  }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return { ...actual, useNavigate: (): ((to: string) => void) => (to: string): void => { navigated.push(to); } };
});
vi.mock('@/hooks', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return {
    ...actual,
    useRegisteredPeers: (): unknown => ({
      registeredPeers: [{ cid: '42', username: 'bob', displayName: 'bob', isOnline: true, isConnected: true }],
    }),
    useConversationPeers: (): unknown => ({ peersWithConversations: [], conversationsLoaded: true }),
    useGroupConversations: (): unknown => ({ groups: [], createGroup }),
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

beforeEach((): void => { navigated.length = 0; createGroup.mockClear(); });

describe('creating a group', () => {
  it('navigates to the group it just created', async (): Promise<void> => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <MembersSection />
        </SidebarProvider>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByTestId('new-group-chat-button'));
    await userEvent.type(screen.getByTestId('create-group-name'), 'Design review');
    await userEvent.click(screen.getByTestId('create-group-add-member'));
    await userEvent.click(screen.getByTestId('create-group-peer-bob'));
    await userEvent.click(screen.getByTestId('create-group-submit'));

    expect(createGroup).toHaveBeenCalled();
    expect(navigated).toContain('/groups/group-77');
  });
});
