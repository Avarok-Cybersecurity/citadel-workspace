/**
 * "Add Child" follows the live schema: any node whose `allowed_child_types` is non-empty offers
 * it (a Room under a Room included), a node with none does not, and when several types are
 * allowed the user chooses -- the sidebar used to take the first one without asking.
 *
 * Mocked: `usePermission` (agent I/O) and `NodeManagementModal` (a protocol-backed form; the
 * test only needs to know which type it was opened for). The tree, menu and picker are production.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { WorkspaceProvider, type WorkspaceState } from '@/contexts/WorkspaceContext';
import type { UsePermissionResult } from '@/hooks/use-permission-result';

vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): UsePermissionResult => ({
    allowed: true, loading: false, reason: null, unanswered: false, answered: true, refresh: async (): Promise<void> => {},
  }) as UsePermissionResult,
}));
vi.mock('@/components/node/NodeManagementModal', () => ({
  NodeManagementModal: ({ entityType, parentId }: { entityType: string; parentId: string }): JSX.Element => (
    <div data-testid="create-opened">{entityType} under {parentId}</div>
  ),
}));

import { HierarchySidebar } from '../HierarchySidebar';

interface TestNode { id: string; name: string; entity_type: { Child: string }; parent_id: string | null; children: string[]; allowed_child_types: string[] }
const node = (id: string, type: string, parent: string | null, children: string[], allowed: string[]): TestNode =>
  ({ id, name: id, entity_type: { Child: type }, parent_id: parent, children, allowed_child_types: allowed });

function renderSidebar(nodes: TestNode[]): void {
  const state: WorkspaceState = {
    nodes: Object.fromEntries(nodes.map((n: TestNode) => [n.id, n])),
    members: {},
    treeSchema: { rules: [{ parent_type: 'Workspace', allowed_child_types: ['Office'] }] },
    loading: { workspace: false, members: false, nodes: false },
  } as unknown as WorkspaceState;
  const wrap = ({ children }: { children: ReactNode }): JSX.Element => (
    <MemoryRouter><ConfirmDialogProvider><TooltipProvider><SidebarProvider>
      <WorkspaceProvider state={state}>{children}</WorkspaceProvider>
    </SidebarProvider></TooltipProvider></ConfirmDialogProvider></MemoryRouter>
  );
  render(<HierarchySidebar />, { wrapper: wrap });
}

/** Select the node first: the focused tree offers a node's ⋯ menu on its own row, once it is in view. */
async function openMenu(id: string): Promise<void> {
  await userEvent.click(screen.getByTestId(`tree-node-${id}`));
  await userEvent.click(await screen.findByTestId(`tree-node-menu-${id}`));
}

describe('Add Child', () => {
  it('is offered on a Room that may hold rooms', async () => {
    renderSidebar([node('room-1', 'Room', null, [], ['Room'])]);
    await openMenu('room-1');
    expect(screen.getByTestId('create-child-room-1')).toBeInTheDocument();
  });

  it('is not offered on a node the schema gives no children', async () => {
    renderSidebar([node('room-1', 'Room', null, [], [])]);
    await openMenu('room-1');
    expect(screen.queryByTestId('create-child-room-1')).toBeNull();
  });

  it('opens the create form directly when exactly one type is allowed', async () => {
    renderSidebar([node('room-1', 'Room', null, [], ['Room'])]);
    await openMenu('room-1');
    await userEvent.click(screen.getByTestId('create-child-room-1'));
    expect(screen.getByTestId('create-opened')).toHaveTextContent('Room under room-1');
    expect(screen.queryByTestId('child-type-picker')).toBeNull();
  });

  it('asks which type when several are allowed, and creates the one chosen', async () => {
    renderSidebar([node('office-1', 'Office', null, [], ['Room', 'Office'])]);
    await openMenu('office-1');
    await userEvent.click(screen.getByTestId('create-child-office-1'));
    expect(screen.getByTestId('child-type-picker')).toBeInTheDocument();
    expect(screen.queryByTestId('create-opened')).toBeNull();
    await userEvent.click(screen.getByTestId('child-type-Office'));
    expect(screen.getByTestId('create-opened')).toHaveTextContent('Office under office-1');
    expect(screen.queryByTestId('child-type-picker')).toBeNull();
  });
});
