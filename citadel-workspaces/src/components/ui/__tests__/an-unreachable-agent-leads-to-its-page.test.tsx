/**
 * When no start-up attempt reaches the agent on this computer, the loader takes the person to the
 * agent's page (start or install it), instead of a spinner and an unexplained move to /connect.
 *
 * Mocked: `useAutoClaimSession`, standing in for claimOnStart's 'agent-unreachable' answer (that
 * decision is covered with its I/O injected by claim-on-start.test.ts). The loader is real.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { WorkspaceProvider, type WorkspaceState } from '@/contexts/WorkspaceContext';

vi.mock('../use-auto-claim-session', async () => {
  const { useEffect } = await import('react');
  return {
    useAutoClaimSession: ({ onAgentUnreachable }: { onAgentUnreachable: () => void }): void => {
      useEffect(() => { onAgentUnreachable(); }, [onAgentUnreachable]);
    },
  };
});

import { WorkspaceLoader } from '../workspace-loader';
import { greetAs } from '@/lib/agent-conversations/__tests__/agent-greeting';

beforeAll(() => greetAs());

describe('an agent no attempt reached', () => {
  it('leads to the agent page', async () => {
    const state: WorkspaceState = { nodes: {}, members: {}, loading: { workspace: true, members: false, nodes: false } } as unknown as WorkspaceState;
    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <ConfirmDialogProvider>
          <WorkspaceProvider state={state}>
            <Routes>
              <Route path="/workspace" element={<WorkspaceLoader><p>workspace</p></WorkspaceLoader>} />
              <Route path="/agent" element={<p data-testid="agent-page">agent</p>} />
            </Routes>
          </WorkspaceProvider>
        </ConfirmDialogProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('agent-page')).toBeInTheDocument();
  });
});
