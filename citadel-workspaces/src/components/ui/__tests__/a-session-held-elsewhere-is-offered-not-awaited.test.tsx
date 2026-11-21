/**
 * A tab whose session another browser holds asks to take it over, instead of
 * waiting for ever on "Workspace data is taking longer than expected".
 *
 * Mocked: `useAutoClaimSession`, standing in for an agent that refused the
 * claim with "in use by another connection" -- that decision is covered, with
 * its I/O injected, by claim-on-start.test.ts. Everything the loader does with
 * the answer is production code: the prompt, the notice, the sign-in.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { WorkspaceProvider, type WorkspaceState } from '@/contexts/WorkspaceContext';

vi.mock('../use-auto-claim-session', async () => {
  const { useEffect } = await import('react');
  return {
    useAutoClaimSession: ({ onHeldElsewhere }: { onHeldElsewhere: (u: string) => void }): void => {
      useEffect(() => { onHeldElsewhere('alice0924'); }, [onHeldElsewhere]);
    },
  };
});

import { WorkspaceLoader } from '../workspace-loader';
import { greetAs } from '@/lib/agent-conversations/__tests__/agent-greeting';
// What "Use it here" lazy-loads, fetched and transformed now, at collection,
// rather than inside the test after the click.
import '@/components/TakeoverSignIn';

// The agent that refused the claim greeted this tab's socket first, as every agent does.
beforeAll(() => greetAs());

function renderLoader(): void {
  const state: WorkspaceState = { nodes: {}, members: {}, loading: { workspace: true, members: false, nodes: false } } as unknown as WorkspaceState;
  render(
    <MemoryRouter>
      <ConfirmDialogProvider>
        <WorkspaceProvider state={state}>
          <WorkspaceLoader><p>workspace</p></WorkspaceLoader>
        </WorkspaceProvider>
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
}

describe('a session another browser holds', () => {
  it('is offered for takeover with the same prompt the switcher uses', async () => {
    renderLoader();
    expect(await screen.findByRole('alertdialog', { name: /alice0924 is open in another window/i })).toBeInTheDocument();
    expect(screen.queryByText(/taking longer than expected/i)).toBeNull();
    expect(screen.getByTestId('session-held-elsewhere')).toBeInTheDocument();
  });

  it('offers to open it here too, and to move it with the username filled in', async () => {
    renderLoader();
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Open here too' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Move it here instead' }));
    expect(await screen.findByDisplayValue('alice0924')).toBeInTheDocument();
  });
});
