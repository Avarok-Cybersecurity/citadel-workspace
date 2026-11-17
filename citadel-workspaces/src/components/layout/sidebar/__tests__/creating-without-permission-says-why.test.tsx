/**
 * A member who may not add to the tree is told so before and after they try.
 *
 * Live: a plain member pressed the hierarchy "+", chose Create Office and
 * submitted; the server refused (`CreateNode` needs EditTreeStructure on the
 * workspace), the dialog stayed open and nothing said why. So the "+" is now
 * disabled with the reason on a known "no", and a refusal that still arrives
 * is written into the dialog, not only into a toast behind it.
 *
 * Mocked: `usePermission` -- the permission fetch is agent I/O; the gate that
 * reads it is the production one.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { WorkspaceProvider, type WorkspaceState } from '@/contexts/WorkspaceContext';
import { EntityManagementModal } from '@/components/shared/EntityManagementModal';
import type { UsePermissionResult } from '@/hooks/use-permission-result';

const answer: { current: Partial<UsePermissionResult> } = { current: {} };
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): UsePermissionResult => ({
    allowed: false, loading: false, reason: null, unanswered: false, answered: true, refresh: async (): Promise<void> => {},
    ...answer.current,
  }) as UsePermissionResult,
}));

import { HierarchySidebar } from '../HierarchySidebar';

const NODE: { id: string; name: string; entity_type: { Child: string }; parent_id: null; children: string[]; allowed_child_types: string[] } = {
  id: 'office-1', name: 'Engineering', entity_type: { Child: 'Office' }, parent_id: null, children: [], allowed_child_types: ['Room'],
};

function renderSidebar(): void {
  const state: WorkspaceState = {
    nodes: { [NODE.id]: NODE },
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

describe('the hierarchy "+"', () => {
  it('is disabled for a member the server would refuse, and says why', () => {
    answer.current = { allowed: false, answered: true, reason: 'You do not have permission to change the structure here.' };
    renderSidebar();
    const add: HTMLElement = screen.getByTestId('add-node-button');
    expect(add).toBeDisabled();
    expect(add.getAttribute('title')).toMatch(/permission/i);
  });

  it('is enabled for somebody who may create', () => {
    answer.current = { allowed: true, answered: true };
    renderSidebar();
    expect(screen.getByTestId('add-node-button')).toBeEnabled();
  });
});

describe('a create the server refuses', () => {
  it('is explained inside the dialog, which stays open', async () => {
    render(
      <EntityManagementModal
        isOpen
        onClose={vi.fn()}
        mode="create"
        modes={{
          create: { title: 'Create New Office', description: 'd', submitLabel: 'Create Office', submittingLabel: 'Creating...' },
        }}
        fields={[{ id: 'name', label: 'Office Name', type: 'input', required: true }]}
        initialData={{ name: 'Sales' }}
        onSubmit={async (): Promise<void> => { throw new Error('Failed to create node: Permission denied: EditTreeStructure required'); }}
        entityName="office"
      />,
    );
    fireEvent.click(screen.getByTestId('entity-modal-submit'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Permission denied/));
    expect(screen.getByTestId('entity-modal-submit')).toBeInTheDocument();
  });
});
