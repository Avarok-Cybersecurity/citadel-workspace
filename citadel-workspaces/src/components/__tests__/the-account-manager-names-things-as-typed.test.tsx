/**
 * Manage Accounts names workspaces as they were typed, and marks the account in use.
 *
 * It printed the agent's dial address (`wss://bench.work.avarok.net/`) and a
 * "Session 6W1TP1" code, and judged "current" from the global connection --
 * which names nobody in a tab that resumed its session -- so the account in
 * use was offered "Switch".
 *
 * Mocked: the agent's session list and the tab-selection read (both I/O).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ActiveSession } from '@/types/session-types';

const LIVE: ActiveSession[] = [
  { cid: 7n, username: 'alice0924', server_address: 'wss://bench.work.avarok.net/' },
  { cid: 8n, username: 'bob0924', server_address: 'wss://bench.work.avarok.net/', server_host: 'bench.work.avarok.net' },
];

vi.mock('@/lib/connection', async (importOriginal: () => Promise<{ connectionManager: object }>) => {
  const actual: { connectionManager: object } = await importOriginal();
  return {
    ...actual,
    connectionManager: Object.assign(Object.create(actual.connectionManager), {
      getStoredSessionsArray: (): [] => [],
      getActiveSessionsResult: async (): Promise<{ ok: true; sessions: ActiveSession[]; signedOut: [] }> => ({ ok: true, sessions: LIVE, signedOut: [] }),
      // A resumed tab: the connection names nobody.
      getConnectionInfo: (): null => null,
      getTabSelectedSession: async (): Promise<null> => null,
    }),
  };
});
vi.mock('@/lib/tab-context', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  getSelectedUser: async (): Promise<{ selectedUsername: string; selectedCid: bigint }> => ({ selectedUsername: 'alice0924', selectedCid: 7n }),
}));

import { AccountManagementDialog } from '../AccountManagementDialog';
import { ConfirmDialogProvider } from '../shared/confirm-dialog';

async function rowOf(username: string): Promise<HTMLElement> {
  const name: HTMLElement = await screen.findByRole('heading', { name: username });
  return name.closest('div.rounded-lg') as HTMLElement;
}

describe('Manage Accounts', () => {
  it('shows hosts as typed, no session codes, and the current account as current', async () => {
    render(
      <MemoryRouter><ConfirmDialogProvider>
        <AccountManagementDialog isOpen onClose={(): void => {}} />
      </ConfirmDialogProvider></MemoryRouter>,
    );

    const alice: HTMLElement = await rowOf('alice0924');
    const bob: HTMLElement = await rowOf('bob0924');
    await within(alice).findByTestId('account-current');

    expect(within(alice).getByText('bench.work.avarok.net')).toBeInTheDocument();
    expect(within(bob).getByText('bench.work.avarok.net')).toBeInTheDocument();
    expect(screen.queryByText(/wss:\/\//)).toBeNull();
    expect(screen.queryByText(/^Session /)).toBeNull();

    expect(within(alice).queryByRole('button', { name: 'Switch' })).toBeNull();
    expect(within(bob).getByRole('button', { name: 'Switch' })).toBeInTheDocument();
    expect(within(bob).queryByTestId('account-current')).toBeNull();
  });
});
