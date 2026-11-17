/**
 * Back at the workspace root is back at the home page.
 *
 * After login the landing view (no nodeId) renders the workspace's home. The
 * sidebar selects the root by navigating to `?nodeId=workspace-root` -- and the
 * root is a sentinel on the server, never a stored node, so with several
 * top-level spaces (the synthetic-root case) that id was not a key of
 * `state.nodes` and WorkspaceView took `nodeId && !node` for a deleted page:
 * landing → a space → the root showed "This page is no longer here".
 *
 * Driven through the real sidebar and router. Mocked: `usePermission` (agent
 * I/O) and BaseOffice, which compiles MDX and mounts the chat and the agent's
 * connection; what is under test is which content WorkspaceView hands it, and
 * the stand-in prints exactly that.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import type { UsePermissionResult } from '@/hooks/use-permission-result';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { ESTATE, renderHierarchy, selectedInUrl } from '@/components/layout/sidebar/__tests__/render-hierarchy';
import { WorkspaceView } from '../WorkspaceView';

vi.mock('@/hooks/use-permission', () => ({
  usePermission: (): UsePermissionResult => ({
    allowed: true, loading: false, reason: null, unanswered: false, answered: true, refresh: async (): Promise<void> => {},
  }) as UsePermissionResult,
}));
vi.mock('@/components/office/BaseOffice', () => ({
  BaseOffice: ({ getInitialContent, nodeId }: { getInitialContent: () => string; nodeId?: string }): JSX.Element => (
    <article data-testid="page" data-node={nodeId ?? 'home'}>{getInitialContent()}</article>
  ),
}));

/** What Office does with the URL: hand its nodeId to the view. */
function Page(): JSX.Element {
  const location: ReturnType<typeof useLocation> = useLocation();
  return <WorkspaceView nodeId={new URLSearchParams(location.search).get('nodeId')} />;
}

describe('the workspace root', () => {
  it('renders the home page again after visiting a space', async () => {
    renderHierarchy(ESTATE, '/workspace', <Page />);
    const landing: string = screen.getByTestId('page').textContent ?? '';
    expect(screen.getByTestId('page')).toHaveAttribute('data-node', 'home');
    expect(landing).toContain('Lexelnet');

    await userEvent.click(screen.getByTestId('tree-node-berlin'));
    await waitFor(() => expect(screen.getByTestId('page')).toHaveAttribute('data-node', 'berlin'));

    await userEvent.click(await screen.findByTestId(`tree-node-${WORKSPACE_ROOT_ID}`));
    await waitFor(() => expect(selectedInUrl()).toBe(WORKSPACE_ROOT_ID));
    expect(screen.queryByText('This page is no longer here')).toBeNull();
    expect(screen.getByTestId('page')).toHaveAttribute('data-node', 'home');
    expect(screen.getByTestId('page').textContent).toBe(landing);
  });

  it('still says a page is gone when a real id is', () => {
    // The positive control: the not-found state itself is intact.
    renderHierarchy(ESTATE, '/workspace?nodeId=deleted-space', <Page />);
    expect(screen.getByText('This page is no longer here')).toBeInTheDocument();
  });
});
