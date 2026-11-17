/**
 * Manage Accounts must not say "No accounts found" before it has looked.
 *
 * Found live (2026-09-30): opened in the first second after the page loaded,
 * the dialog said "No accounts found. Join a workspace to get started." and
 * kept saying it for as long as it stayed open, while the agent held three
 * saved accounts. Reopening it listed them. It copied the in-memory list once,
 * on open, before the agent's answer had arrived.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AccountManagementDialog } from '../AccountManagementDialog';
import { ConfirmDialogProvider } from '../shared/confirm-dialog';

interface Stored { username: string; serverAddress: string; cid: bigint }

const agent: { stored: Stored[]; answer: (() => void) | null; readsSucceed: boolean } = {
  stored: [],
  answer: null,
  readsSucceed: true,
};
let memory: Stored[] = [];

vi.mock('@/lib/connection/sessions-read-state', () => {
  let read: boolean = false;
  return {
    markSessionsRead: (): void => { read = true; },
    sessionsHaveBeenRead: (): boolean => read,
    resetSessionReadTracking: (): void => { read = false; },
  };
});

// Partial, over the real manager (see removing-an-account-asks-first). The
// read is held open until the test answers it, which is the load-time race.
vi.mock('@/lib/connection', async (importOriginal) => {
  const actual: { connectionManager: Record<string, unknown> } = await importOriginal();
  const readState: { markSessionsRead: () => void } = await import('@/lib/connection/sessions-read-state');
  return {
    ...actual,
    connectionManager: Object.assign(Object.create(actual.connectionManager as object), {
      getStoredSessionsArray: (): Stored[] => memory,
      reloadStoredSessions: (): Promise<void> => new Promise<void>((resolve) => {
        agent.answer = (): void => {
          if (agent.readsSucceed) { memory = agent.stored; readState.markSessionsRead(); }
          resolve();
        };
      }),
      getActiveSessionsResult: async (): Promise<{ ok: boolean; sessions: never[]; signedOut: never[] }> => ({ ok: true, sessions: [], signedOut: [] }),
    }),
  };
});
vi.mock('@/hooks/use-toast', () => ({
  useToast: (): { toast: () => void } => ({ toast: (): void => {} }),
}));

async function open(): Promise<void> {
  render(
    <MemoryRouter>
      <ConfirmDialogProvider>
        <AccountManagementDialog isOpen onClose={(): void => {}} />
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
  await act(async (): Promise<void> => { await Promise.resolve(); });
}

async function agentAnswers(): Promise<void> {
  await act(async (): Promise<void> => { agent.answer?.(); await Promise.resolve(); });
}

beforeEach(async (): Promise<void> => {
  agent.stored = [];
  agent.answer = null;
  agent.readsSucceed = true;
  memory = [];
  (await import('@/lib/connection/sessions-read-state')).resetSessionReadTracking();
});

describe('opening Manage Accounts before the saved list has arrived', () => {
  it('says it is loading, not that there are no accounts', async (): Promise<void> => {
    agent.stored = [{ username: 'ada', serverAddress: 'wss://one', cid: 1n }];
    await open();

    expect(screen.getByTestId('saved-accounts-loading')).toBeTruthy();
    expect(screen.queryByText(/No accounts found/i)).toBeNull();
  });

  it('lists the accounts in the same dialog once the agent answers', async (): Promise<void> => {
    // The defect: this dialog kept its first, empty copy until reopened.
    agent.stored = [{ username: 'ada', serverAddress: 'wss://one', cid: 1n }];
    await open();
    await agentAnswers();

    expect(await screen.findByText('ada')).toBeTruthy();
    expect(screen.queryByText(/No accounts found/i)).toBeNull();
    expect(screen.queryByTestId('saved-accounts-loading')).toBeNull();
  });

  it('still says there are none when the agent answers "none"', async (): Promise<void> => {
    // Positive control: without it, never showing the empty state would pass.
    await open();
    await agentAnswers();

    expect(await screen.findByText(/No accounts found/i)).toBeTruthy();
  });

  it('says the list could not be read, rather than that it is empty', async (): Promise<void> => {
    agent.readsSucceed = false;
    await open();
    await agentAnswers();

    expect(await screen.findByTestId('saved-accounts-unreadable')).toBeTruthy();
    expect(screen.queryByText(/No accounts found/i)).toBeNull();
  });
});
