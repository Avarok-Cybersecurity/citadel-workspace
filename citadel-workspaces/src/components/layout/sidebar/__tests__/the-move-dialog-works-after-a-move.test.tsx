/**
 * The Move dialog still works after the first move.
 *
 * MoveNodeDialog set `moving` when a destination was picked and nothing ever
 * cleared it. The dialog is mounted for the sidebar's whole life (it renders
 * nothing when there is no node), so the flag outlived the move: the next Move…
 * opened with every destination and Cancel disabled, and only a reload brought
 * them back.
 *
 * Rendered through the real sidebar and tree. Mocked: `WorkspaceService.moveNode`
 * (the server round trip) and `usePermission` (a server query, answered here as
 * the same "allowed" the other sidebar specs use).
 */
import { describe, it, expect, vi, type MockInstance } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { WorkspaceProvider, type WorkspaceState } from '@/contexts/WorkspaceContext';
import WorkspaceService from '@/lib/workspace-service';
import type { UsePermissionResult } from '@/hooks/use-permission-result';
import { HierarchySidebar } from '../HierarchySidebar';

vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): UsePermissionResult => ({
    allowed: true, loading: false, reason: null, unanswered: false, answered: true, refresh: async (): Promise<void> => {},
  }) as UsePermissionResult,
}));

type Row = { id: string; name: string; entity_type: { Child: string }; parent_id: string | null; children: string[]; allowed_child_types: string[] };

const NODES: Record<string, Row> = {
  o1: { id: 'o1', name: 'Engineering', entity_type: { Child: 'Office' }, parent_id: null, children: ['r1', 'r2'], allowed_child_types: ['Room'] },
  o2: { id: 'o2', name: 'Design', entity_type: { Child: 'Office' }, parent_id: null, children: [], allowed_child_types: ['Room'] },
  r1: { id: 'r1', name: 'Standup', entity_type: { Child: 'Room' }, parent_id: 'o1', children: [], allowed_child_types: [] },
  r2: { id: 'r2', name: 'Retro', entity_type: { Child: 'Room' }, parent_id: 'o1', children: [], allowed_child_types: [] },
};

function renderSidebar(): void {
  const state: WorkspaceState = {
    nodes: NODES,
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

/** Click down to the room (its office, then the room itself) so its own row carries the ⋯ menu. */
async function openMove(nodeId: string): Promise<HTMLElement> {
  for (const step of [NODES[nodeId].parent_id, nodeId]) {
    if (step !== null) await userEvent.click(await screen.findByTestId(`tree-node-${step}`));
  }
  await userEvent.click(await screen.findByTestId(`tree-node-menu-${nodeId}`));
  await userEvent.click(await screen.findByTestId(`move-node-${nodeId}`));
  return screen.findByRole('dialog');
}

describe('the Move dialog', () => {
  it('offers its destinations and Cancel again after a move', async (): Promise<void> => {
    const moveNode: MockInstance<typeof WorkspaceService.moveNode> = vi.spyOn(WorkspaceService, 'moveNode').mockResolvedValue(undefined);
    renderSidebar();

    const first: HTMLElement = await openMove('r1');
    await userEvent.click(within(first).getByTestId('move-target-o2'));
    await waitFor((): void => { expect(moveNode).toHaveBeenCalledWith('r1', 'o2'); });
    await waitFor((): void => { expect(screen.queryByRole('dialog')).toBeNull(); });

    const second: HTMLElement = await openMove('r2');
    // Positive control: this is the dialog for the second node.
    expect(second).toHaveTextContent('Move Retro');
    expect(within(second).getByTestId('move-target-o2')).toBeEnabled();
    expect(within(second).getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });
});
