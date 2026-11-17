/**
 * The Members tab's Guests filter (Calendar design §3.6.4): the server marks which listed members
 * a live booking link lets in, and the tab shows everyone, or only them, each marked as a guest
 * from outside. Real: the response handler that reads the reply, the event bus, the tab, its rows
 * and filter. The workspace service is the only stand-in, as in the tab's other specs: it is the
 * wire, and the reply arrives through the handler as the server's does.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';

vi.mock('@/lib/workspace-service', () => ({
  default: { listMembers: async (): Promise<void> => {} },
}));

const { handleGeneratedVariants } = await import('@/lib/workspace-response-handler/generated-variant-handlers');
const { WORKSPACE_ROOT_ID } = await import('@/lib/workspace-constants');
const { WorkspaceProvider } = await import('@/contexts/WorkspaceContext');
const { PermissionsProvider } = await import('@/contexts/PermissionsContext');
const { MembersTab } = await import('../MembersTab');
import type { WorkspaceState } from '@/contexts/WorkspaceContext';

const STATE: WorkspaceState = {
  workspace: { id: WORKSPACE_ROOT_ID, name: 'Acme' }, members: {}, nodes: {}, nodesUnavailable: false, membershipRefused: false, treeSchema: null,
  loading: { workspace: false, members: false, nodes: false }, messages: { byPeer: {} }, typing: { peerIds: [], lastUpdated: 0 },
} as WorkspaceState;

const user = (id: string): Record<string, unknown> => ({ id, name: id, role: 'Member', permissions: {}, metadata: [] });

function reply(guests: string[] | undefined): void {
  const members: { guests?: string[] | undefined; domain_id: "workspace-root"; members: Record<string, unknown>[]; inherited_from: {}; } = { domain_id: WORKSPACE_ROOT_ID, members: [user('ada'), user('gus')], inherited_from: {}, ...(guests ? { guests } : {}) };
  act(() => { handleGeneratedVariants({ Members: members } as unknown as WorkspaceProtocolResponse, { cid: 0, request_id: 'r' }); });
}

function tab(): void {
  render(<PermissionsProvider><WorkspaceProvider state={STATE}><MembersTab entityType="workspace" entityId={WORKSPACE_ROOT_ID} onClose={() => {}} /></WorkspaceProvider></PermissionsProvider>);
}

describe('the Members tab', () => {
  it('shows everyone, or only the guests, each marked, with how many', async () => {
    tab();
    reply(['gus']);
    const everyone: HTMLElement = await screen.findByTestId('members-filter-everyone');
    expect(everyone).toHaveTextContent('Everyone (2)');
    expect(everyone).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('members-filter-guests')).toHaveTextContent('Guests (1)');
    expect(screen.getByTestId('member-row-ada')).toBeInTheDocument();
    expect(within(screen.getByTestId('member-row-gus')).getByTestId('member-guest-gus')).toHaveTextContent('Guest from outside');
    expect(screen.queryByTestId('member-guest-ada')).toBeNull();

    await userEvent.click(screen.getByTestId('members-filter-guests'));
    expect(screen.getByTestId('members-filter-guests')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('member-row-ada')).toBeNull();
    expect(screen.getByTestId('member-row-gus')).toBeInTheDocument();
  });

  it('has no guests from a server that predates them, and says so when filtered', async () => {
    tab();
    reply(undefined);
    expect(await screen.findByTestId('members-filter-guests')).toHaveTextContent('Guests (0)');
    await userEvent.click(screen.getByTestId('members-filter-guests'));
    expect(screen.getByText('No guests here')).toBeInTheDocument();
    expect(screen.queryByTestId('member-row-gus')).toBeNull();
  });
});
