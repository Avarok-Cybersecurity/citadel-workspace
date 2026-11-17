/**
 * The empty tree's advice matches what the reader can do.
 *
 * Measured live: a Member saw "Your workspace is empty. Click the + button to create
 * your first space." beside a "+" that is disabled for them ("You don't have the
 * 'Reorganise the workspace' permission").
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TreeNodesSection } from '../TreeNodesSection';

function emptyText(createBlockedReason: string | null): string {
  render(
    <MemoryRouter>
      <SidebarProvider>
        <TreeNodesSection workspaceName="Test Workspace" title="Spaces" nodes={undefined} isLoading={false} unavailable={false}
          onNodeSelect={(): void => {}} onNodeCreate={(): void => {}} createBlockedReason={createBlockedReason} />
      </SidebarProvider>
    </MemoryRouter>,
  );
  return screen.getByTestId('tree-empty').textContent ?? '';
}

describe('an empty workspace tree', () => {
  it('points someone who may create at the + button', () => {
    expect(emptyText(null)).toMatch(/Click the \+ button/);
  });

  it('does not point someone who may not at a disabled button', () => {
    const text: string = emptyText('You don\'t have the "Reorganise the workspace" permission. Your role: Member');
    expect(text).not.toMatch(/Click the \+/);
    expect(text).toMatch(/administrator/i);
  });
});
