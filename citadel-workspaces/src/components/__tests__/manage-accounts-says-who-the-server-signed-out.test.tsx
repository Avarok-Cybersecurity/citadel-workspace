/**
 * Manage Accounts marks a saved account the server signed out, and "Sign in"
 * opens the sign-in for it.
 *
 * The agent's reconnect gives up on a session (the server refused it, stayed
 * unreachable, or held the old one too long) and lists it in GetSessions'
 * `signed_out` until the account signs in again. Before, the saved row looked
 * like any other offline account.
 *
 * MOCKS, and why: as in the-account-list-waits-for-its-read, the connection
 * manager is the real one with the agent's two answers (the saved list and
 * GetSessions) replaced, and the toast is silenced. The dialog, the rows, the
 * matcher and the sign-in dialog are the production ones.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const REASON: string = 'CID not registered to this node';
const saved: Array<{ username: string; serverAddress: string; cid: bigint }> = [
  { username: 'alice', serverAddress: 'ws.example', cid: 7n },
  { username: 'bob', serverAddress: 'ws.example', cid: 9n },
];

vi.mock('@/lib/connection', async (importOriginal) => {
  const actual: { connectionManager: Record<string, unknown> } = await importOriginal();
  const readState: { markSessionsRead: () => void } = await import('@/lib/connection/sessions-read-state');
  return {
    ...actual,
    connectionManager: Object.assign(Object.create(actual.connectionManager as object), {
      getStoredSessionsArray: (): typeof saved => saved,
      reloadStoredSessions: async (): Promise<void> => { readState.markSessionsRead(); },
      getActiveSessionsResult: async (): Promise<unknown> => ({
        ok: true,
        sessions: [],
        signedOut: [{ cid: 7n, username: 'alice', reason: REASON }],
      }),
    }),
  };
});
vi.mock('@/hooks/use-toast', () => ({
  useToast: (): { toast: () => void } => ({ toast: (): void => {} }),
}));

import { AccountManagementDialog } from '../AccountManagementDialog';
import { ConfirmDialogProvider } from '../shared/confirm-dialog';
import { SIGNED_OUT_COPY } from '../signed-out/signed-out-copy';
import { greetAs } from '@/lib/agent-conversations/__tests__/agent-greeting';
// What "Sign in" lazy-loads, fetched and transformed now, at collection, rather
// than inside the test after the click.
import '../TakeoverSignIn';

describe('Manage Accounts and an account the server signed out', () => {
  it('marks only that account, with the reason, and Sign in opens its sign-in', async (): Promise<void> => {
    // The leader socket was greeted by an agent that does not host conversations,
    // so the sign-in is the password form rather than "open it here too".
    //
    // Left undecided, TakeoverSignIn's question went to whoever led: the real
    // instance channel elects this tab 2.5 s (real timers) after it loads. A click
    // before that asked a leader that did not exist yet and fell through to the
    // form only when the election answered "Not leader"; a click after it, on a
    // loaded runner, waited on a socket that never opens, and the form never came.
    await greetAs('older');
    render(
      <MemoryRouter>
        <ConfirmDialogProvider>
          <AccountManagementDialog isOpen onClose={(): void => {}} />
        </ConfirmDialogProvider>
      </MemoryRouter>,
    );
    const marks: HTMLElement[] = await screen.findAllByTestId('account-signed-out');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toContain(SIGNED_OUT_COPY.status);
    expect(marks[0].textContent).toContain(REASON);
    // Bob's row is unchanged.
    expect(screen.getAllByRole('button', { name: 'Switch' })).toHaveLength(1);

    await act(async (): Promise<void> => {
      await userEvent.click(screen.getByRole('button', { name: SIGNED_OUT_COPY.signIn }));
    });
    // The existing sign-in (TakeoverSignIn), its username filled in for alice.
    expect(await screen.findByDisplayValue('alice')).toBeTruthy();
  });
});
