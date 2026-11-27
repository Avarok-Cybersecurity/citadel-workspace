/**
 * A member list that failed to load says so and offers Try again, which asks again and shows the
 * list when it arrives. It used to fade a toast and leave "No members found" behind, which was untrue.
 * The workspace service is the only stand-in (the wire); the reply arrives through the real handler.
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';

const listMembers: Mock<(id: string) => Promise<void>> = vi.fn<(id: string) => Promise<void>>();
vi.mock('@/lib/workspace-service', () => ({ default: { listMembers: (id: string): Promise<void> => listMembers(id) } }));

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

describe('the Members tab after a failed load', () => {
  it('says the load failed, not "No members found", and Try again loads the list', async () => {
    listMembers.mockRejectedValueOnce(new Error('No active connection available. Please connect first.')).mockResolvedValue(undefined);
    render(<PermissionsProvider><WorkspaceProvider state={STATE}><MembersTab entityType="workspace" entityId={WORKSPACE_ROOT_ID} onClose={() => {}} /></WorkspaceProvider></PermissionsProvider>);
    const notice: HTMLElement = await screen.findByTestId('recovery-list.load-failed');
    expect(notice).toHaveTextContent('No active connection available');
    expect(screen.queryByText('No members found')).toBeNull();

    const asked: number = listMembers.mock.calls.length;
    await userEvent.click(screen.getByTestId('recovery-control-retry'));
    expect(listMembers).toHaveBeenCalledTimes(asked + 1);
    act(() => { handleGeneratedVariants({ Members: { domain_id: WORKSPACE_ROOT_ID, members: [{ id: 'ada', name: 'ada', banned: false, permissions: {}, metadata: [] }], inherited_from: {} } } as unknown as WorkspaceProtocolResponse, { cid: 0, request_id: 'r' }); });
    expect(await screen.findByTestId('member-row-ada')).toBeInTheDocument();
    expect(screen.queryByTestId('recovery-list.load-failed')).toBeNull();
  });
});
