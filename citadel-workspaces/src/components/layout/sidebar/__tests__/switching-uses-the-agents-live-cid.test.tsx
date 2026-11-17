/**
 * The workspace switcher switches with the CID the agent holds now.
 *
 * Live: "Switch Failed — Session CID not available" for every other account,
 * including one registered seconds earlier in another tab. The stored record's
 * CID had been erased by a tab boot (see booting-a-tab-keeps-every-accounts-cid)
 * and the switcher trusted nothing else, while the landing page resumed the
 * same accounts from the agent's live list without trouble.
 *
 * Mocked: the connection manager's reads (agent + IndexedDB I/O), the tab
 * selection, and `switchToSession` -- the switch sequence itself is covered by
 * a-session-in-another-window-is-offered-not-adopted; this is about the CID
 * handed to it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { WorkspaceSwitcher } from '../WorkspaceSwitcher';

// The stored copy of bob has no CID, as a boot left it; the agent holds him as 42.
const SESSIONS: Array<{ username: string; serverAddress: string; cid?: bigint; fullName: string }> = [
  { username: 'ada', serverAddress: 'acme.work.example.net', cid: 1n, fullName: 'Ada L' },
  { username: 'bob', serverAddress: 'acme.work.example.net', fullName: 'Bob K' },
];
const reloads: { count: number } = { count: 0 };
vi.mock('@/lib/connection', async (importOriginal) => {
  const actual: { connectionManager: Record<string, unknown> } = await importOriginal();
  return {
    ...actual,
    connectionManager: Object.assign(Object.create(actual.connectionManager as object), {
      getStoredSessions: (): { sessions: typeof SESSIONS } => ({ sessions: SESSIONS }),
      getStoredSessionsArray: (): typeof SESSIONS => SESSIONS,
      getConnectionInfo: (): { cid: bigint } => ({ cid: 1n }),
      reloadStoredSessions: async (): Promise<{ sessions: typeof SESSIONS }> => { reloads.count += 1; return { sessions: SESSIONS }; },
      // Behind the edge `server_address` is the resolved address; `server_host` is what was typed.
      getActiveSessionsResult: async (): Promise<{ ok: boolean; sessions: unknown[]; signedOut: [] }> => ({
        ok: true,
        signedOut: [],
        sessions: [{ cid: 42n, username: 'bob', server_address: '104.16.0.1:443', server_host: 'acme.work.example.net' }],
      }),
    }),
  };
});
vi.mock('@/lib/connection-service', () => ({
  ConnectionService: { getInstance: (): { onConnectionChange: () => () => void } => ({ onConnectionChange: (): (() => void) => (): void => {} }) },
}));
vi.mock('@/lib/tab-context', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSelectedUser: async (): Promise<{ selectedUsername: string; selectedServerAddress: string }> => ({ selectedUsername: 'ada', selectedServerAddress: 'acme.work.example.net' }),
}));
const toasts: { title?: string }[] = [];
vi.mock('@/hooks/use-toast', () => ({ useToast: (): { toast: (t: { title?: string }) => void } => ({ toast: (t: { title?: string }): void => { toasts.push(t); } }) }));
const switched: { cid: bigint }[] = [];
vi.mock('@/lib/sessions/switch-to-session', () => ({
  switchToSession: async (session: { cid: bigint }): Promise<void> => { switched.push(session); },
}));

async function openMenu(): Promise<void> {
  render(<MemoryRouter><ConfirmDialogProvider><WorkspaceSwitcher workspaceName="Acme" /></ConfirmDialogProvider></MemoryRouter>);
  await userEvent.click(await screen.findByTestId('workspace-switcher'));
}

describe('switching to another account', () => {
  beforeEach((): void => { switched.length = 0; toasts.length = 0; reloads.count = 0; });

  it('uses the CID the agent holds, when the stored copy has none', async () => {
    await openMenu();
    await userEvent.click(await screen.findByText('Bob K'));
    await waitFor(() => expect(switched.map((s) => s.cid)).toEqual([42n]));
    expect(toasts.map((t) => t.title)).not.toContain('Switch Failed');
  });

  it('re-reads the stored accounts when the menu opens', async () => {
    await openMenu();
    await waitFor(() => expect(reloads.count).toBeGreaterThan(0));
  });
});
