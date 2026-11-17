/**
 * The owner's report, end to end through the top bar's switcher: "when I try
 * changing workspaces by clicking another account, I get this error: Session
 * 14197768845630597388 not found".
 *
 * bob is a saved account the agent no longer holds (signed out, or the agent
 * restarted). His row must say so, and clicking it must open his sign-in with
 * what is known -- never claim the saved CID, which the agent can only refuse.
 *
 * Mocked: the connection manager's reads (agent + IndexedDB I/O), the tab
 * selection, the toast sink, and the agent's ClaimSession answer -- which is
 * the refusal the owner saw, so a claim that is still sent shows up as it did.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { WorkspaceSwitcher } from '../WorkspaceSwitcher';

const STALE: bigint = 14197768845630597388n;
const SESSIONS: Array<{ username: string; serverAddress: string; cid: bigint; fullName: string }> = [
  { username: 'ada', serverAddress: 'acme.work.example.net', cid: 1n, fullName: 'Ada L' },
  { username: 'bob', serverAddress: 'acme.work.example.net', cid: STALE, fullName: 'Bob K' },
];
vi.mock('@/lib/connection', async (importOriginal) => {
  const actual: { connectionManager: Record<string, unknown> } = await importOriginal();
  return {
    ...actual,
    connectionManager: Object.assign(Object.create(actual.connectionManager as object), {
      getStoredSessions: (): { sessions: typeof SESSIONS } => ({ sessions: SESSIONS }),
      getStoredSessionsArray: (): typeof SESSIONS => SESSIONS,
      getConnectionInfo: (): { cid: bigint } => ({ cid: 1n }),
      reloadStoredSessions: async (): Promise<{ sessions: typeof SESSIONS }> => ({ sessions: SESSIONS }),
      waitForReady: async (): Promise<void> => {},
      // The agent holds ada only.
      getActiveSessionsResult: async (): Promise<{ ok: boolean; sessions: unknown[]; signedOut: [] }> => ({
        ok: true, signedOut: [],
        sessions: [{ cid: 1n, username: 'ada', server_address: '104.16.0.1:443', server_host: 'acme.work.example.net' }],
      }),
    }),
  };
});
const claims: bigint[] = [];
vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    claimSession: async (cid: bigint): Promise<void> => { claims.push(cid); throw new Error(`Session ${cid} not found`); },
  },
}));
vi.mock('@/lib/connection-service', () => ({
  ConnectionService: { getInstance: (): { onConnectionChange: () => () => void } => ({ onConnectionChange: (): (() => void) => (): void => {} }) },
}));
vi.mock('@/lib/tab-context', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSelectedUser: async (): Promise<{ selectedUsername: string; selectedServerAddress: string }> => ({ selectedUsername: 'ada', selectedServerAddress: 'acme.work.example.net' }),
}));
const toasts: { title?: string; description?: string }[] = [];
vi.mock('@/hooks/use-toast', () => ({
  useToast: (): { toast: (t: { title?: string }) => void } => ({ toast: (t: { title?: string }): void => { toasts.push(t); } }),
}));

async function openMenu(): Promise<void> {
  render(<MemoryRouter><ConfirmDialogProvider><WorkspaceSwitcher workspaceName="Acme" /></ConfirmDialogProvider></MemoryRouter>);
  await userEvent.click(await screen.findByTestId('workspace-switcher'));
}

describe('clicking a saved account the agent does not hold', () => {
  beforeEach((): void => { claims.length = 0; toasts.length = 0; });

  it('is shown as signed out, named as a sign-in', async () => {
    await openMenu();
    const row: HTMLElement = await screen.findByTestId('switcher-account-signed-out');
    expect(row).toHaveTextContent('Signed out');
    expect(row).toHaveAccessibleName('Sign in to bob on acme.work.example.net (signed out)');
  });

  it('opens his sign-in with what is known, and claims nothing', async () => {
    await openMenu();
    await userEvent.click(await screen.findByTestId('switcher-account-signed-out'));
    expect(await screen.findByDisplayValue('bob', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByTestId('login-notice')).toHaveTextContent('bob on acme.work.example.net is signed out.');
    expect(screen.getByTestId('login-scope')).toHaveTextContent('Signing in to acme.work.example.net');
    expect(claims).toEqual([]);
  });

  it('never shows the raw refusal', async () => {
    await openMenu();
    await userEvent.click(await screen.findByTestId('switcher-account-signed-out'));
    await screen.findByDisplayValue('bob', {}, { timeout: 5000 });
    await waitFor(() => expect(JSON.stringify(toasts)).not.toMatch(/not found|14197768845630597388/));
  });
});
