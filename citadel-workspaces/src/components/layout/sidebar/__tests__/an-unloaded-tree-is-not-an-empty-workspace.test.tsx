/**
 * "Your workspace is empty. Click the + button to create your first space" is
 * advice, and it was given after a load that never came back.
 *
 * `loading-flag-timeout.ts` lowers the flag after 15s so the tree cannot spin
 * forever, and its docstring calls the empty state "the honest fallback …
 * at least a statement the user can act on". For a LIST that is true. For this
 * one it is not: acting on it creates a duplicate space in a workspace whose
 * contents merely did not arrive.
 *
 * `use-domain-members` had already reached the third answer for members —
 * "there is a third answer, which is to say what happened" — and the tree, the
 * most-used surface in the app, was left on the second.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TreeNodesSection } from '../TreeNodesSection';

function tree(props: { isLoading: boolean; unavailable: boolean }): void {
  render(
    <MemoryRouter>
      <SidebarProvider>
      <TreeNodesSection workspaceName="Test Workspace"
        title="Spaces"
        nodes={undefined}
        isLoading={props.isLoading}
        unavailable={props.unavailable}
        onNodeSelect={(): void => {}}
      />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe('the tree with nothing in it', () => {
  it('says the workspace is empty when that is what it knows', () => {
    // The positive control: without it, "does not say empty" passes on a tree
    // that never says anything.
    tree({ isLoading: false, unavailable: false });
    expect(screen.getByTestId('tree-empty')).toBeTruthy();
    expect(screen.queryByTestId('tree-unavailable')).toBeNull();
  });

  it('says it is loading while it is', () => {
    tree({ isLoading: true, unavailable: false });
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it('does not call a failed load an empty workspace', () => {
    tree({ isLoading: false, unavailable: true });

    const said: string = screen.getByTestId('tree-unavailable').textContent ?? '';
    expect(said).toMatch(/could not be loaded/i);
    // The specific advice that was wrong: creating a space is the last thing
    // this user should be told to do.
    expect(said).not.toMatch(/create your first space/i);
    expect(screen.queryByTestId('tree-empty')).toBeNull();
  });
});
