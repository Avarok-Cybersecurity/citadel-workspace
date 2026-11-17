/**
 * "Members can see each other" shows the node's stored value, to whoever holds
 * EditWorkspaceConfig -- what the server asks of SetMembersVisible.
 *
 * Real: the switch and the workspace context; only the store's contents are
 * chosen. Mocked: WorkspaceService.setMembersVisible, the network write, so a
 * click can be observed without a server (the write itself is covered by
 * the-members-switch-waits-for-the-server.test.ts); and the permission answer,
 * the permissions service's I/O, as a settled value.
 */
import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { WorkspaceContext } from '@/contexts/WorkspaceContext';
import { MembersVisibilitySwitch } from '../MembersVisibilitySwitch';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';

const setMembersVisible: Mock<(nodeId: string, visible: boolean) => Promise<void>> = vi.fn(async (): Promise<void> => {});
vi.mock('@/lib/workspace-service', () => ({
  default: { setMembersVisible: (nodeId: string, visible: boolean): Promise<void> => setMembersVisible(nodeId, visible) },
}));

const holds: { current: boolean } = vi.hoisted((): { current: boolean } => ({ current: false }));
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): import('@/hooks/use-permission-result').UsePermissionResult => ({
    allowed: holds.current, loading: false, unanswered: false, answered: true, reason: null, refresh: async (): Promise<void> => undefined,
  }),
}));

afterEach(() => { cleanup(); setMembersVisible.mockClear(); });

type ContextValue = React.ContextType<typeof WorkspaceContext>;

/** `configures`: the reader holds EditWorkspaceConfig. */
function renderAs(configures: boolean, viewMembers: boolean, entityType: string = 'office'): void {
  holds.current = configures;
  const node: DomainNode = { id: 'o1', default_permissions: { view_members: viewMembers } } as unknown as DomainNode;
  const value: ContextValue = { state: { nodes: { o1: node }, currentUser: {} } } as unknown as ContextValue;
  render(
    <WorkspaceContext.Provider value={value}>
      <MembersVisibilitySwitch entityType={entityType} entityId="o1" />
    </WorkspaceContext.Provider>,
  );
}

describe('the "Members can see each other" switch', () => {
  it('shows whoever configures the workspace the stored value, off and on', () => {
    renderAs(true, false);
    expect(screen.getByTestId('members-visible-toggle').getAttribute('aria-checked')).toBe('false');
    cleanup();
    renderAs(true, true);
    expect(screen.getByTestId('members-visible-toggle').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Members can see each other')).toBeTruthy();
  });

  it('is not shown to someone known not to hold EditWorkspaceConfig', () => {
    renderAs(false, true);
    expect(screen.queryByTestId('members-visible-setting')).toBeNull();
  });

  it('has no place on the workspace, which is not a node', () => {
    renderAs(true, true, 'workspace');
    expect(screen.queryByTestId('members-visible-setting')).toBeNull();
  });

  it('sends the new value for this node', async () => {
    renderAs(true, true);
    await act(async (): Promise<void> => { fireEvent.click(screen.getByTestId('members-visible-toggle')); });
    expect(setMembersVisible).toHaveBeenCalledWith('o1', false);
  });
});
