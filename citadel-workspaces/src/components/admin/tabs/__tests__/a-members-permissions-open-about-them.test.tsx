/**
 * The admin panel's Members tab opened the workspace-wide role matrix for ONE
 * member -- the defect the owner reported from the sidebar, by a second door.
 * Its Permissions button now opens the one-member editor at the level the tab
 * is about. Real tab, row, dialog and editor; the workspace service (the wire)
 * is the only stand-in, and answers arrive on the event emitter as the server's do.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getUserPermissions: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/workspace-service', () => ({
  default: {
    listMembers: async (): Promise<void> => {},
    getUserPermissions: (...args: unknown[]): unknown => getUserPermissions(...args),
  },
}));

const { eventEmitter } = await import('@/lib/event-emitter');
const { WORKSPACE_ROOT_ID } = await import('@/lib/workspace-constants');
const { WorkspaceProvider } = await import('@/contexts/WorkspaceContext');
const { PermissionsProvider } = await import('@/contexts/PermissionsContext');
const { MembersTab } = await import('../MembersTab');
import type { WorkspaceState } from '@/contexts/WorkspaceContext';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';

const HQ: DomainNode = {
  id: 'hq', parent_id: WORKSPACE_ROOT_ID, entity_type: { Child: 'Office' }, depth: 0, name: 'HQ', description: '', owner_id: '',
  members: [], children: [], mdx_content: '', mdx_content_hash: null, rules: null, chat_enabled: false, chat_channel_id: null,
  default_permissions: {} as DomainNode['default_permissions'], metadata: [], allowed_child_types: [], is_default: false,
  created_at: 0n, updated_at: 0n,
};
const STATE: WorkspaceState = {
  workspace: { id: WORKSPACE_ROOT_ID, name: 'Acme' }, members: {}, nodes: { hq: HQ }, nodesUnavailable: false, membershipRefused: false, treeSchema: null,
  loading: { workspace: false, members: false, nodes: false }, messages: { byPeer: {} }, typing: { peerIds: [], lastUpdated: 0 },
} as WorkspaceState;

describe('Permissions on one member in the admin panel', () => {
  it('opens the editor about that member, at the level the tab is for -- not the role matrix', async () => {
    render(<PermissionsProvider><WorkspaceProvider state={STATE}><MembersTab entityType="office" entityId="hq" onClose={() => {}} /></WorkspaceProvider></PermissionsProvider>);
    act(() => {
      eventEmitter.emit('members:loaded', { domainId: 'hq', members: [{ id: 'ada', username: 'ada', displayName: 'Ada Lovelace', role: 'Member' }] });
    });
    await userEvent.click(await screen.findByTestId('members-advanced-toggle'));
    await userEvent.click(screen.getByTestId('member-permissions-ada'));

    expect(await screen.findByRole('dialog', { name: 'Ada Lovelace’s permissions' })).toBeInTheDocument();
    expect(screen.getByTestId('member-permissions-path')).toHaveTextContent('HQ');
    expect(screen.queryByRole('heading', { name: 'Role permissions' })).toBeNull();
    await waitFor(() => expect(getUserPermissions).toHaveBeenCalledWith('ada', 'hq'));
    expect(getUserPermissions).toHaveBeenCalledWith('ada', WORKSPACE_ROOT_ID);
    // Closing it returns to the list, which never went away.
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('member-permissions-dialog')).toBeNull();
    expect(screen.getByTestId('members-tab-content')).toBeInTheDocument();
  });
});
