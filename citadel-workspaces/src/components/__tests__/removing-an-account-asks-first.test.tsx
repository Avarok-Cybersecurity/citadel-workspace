/**
 * Removing a saved account asks first, and clearing all of them asks too.
 *
 * These are the last two `AlertDialog` confirmations in the app that no test at
 * any level exercised. Round 417 found what that costs: a deregistration that
 * silently did nothing for weeks while three checks reported success. Round 418
 * covered the file-manager pair and round 432 the chat-history one; this is the
 * remainder.
 *
 * Both are destructive and neither is undoable from the UI — one forgets a
 * single account, the other forgets every account on the device.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AccountManagementDialog } from '../AccountManagementDialog';
import { ConfirmDialogProvider } from '../shared/confirm-dialog';

const removed: Array<{ username: string; serverAddress: string }> = [];
let cleared: number = 0;

// Partial, spreading the real manager. A bare replacement broke on
// `getConnectionInfo`, which the tree below also calls -- the same thing that
// bit round 430's mock of tab-context.
vi.mock('@/lib/connection', async (importOriginal) => {
  const actual: { connectionManager: Record<string, unknown> } = await importOriginal();
  return {
    ...actual,
    // `Object.create`, not a spread. `connectionManager` is a class instance,
    // and `{...instance}` copies own enumerable properties only -- every method
    // lives on the prototype and vanishes. Using the real object AS the
    // prototype keeps them and lets these three shadow.
    connectionManager: Object.assign(Object.create(actual.connectionManager as object), {
      getStoredSessionsArray: (): Array<{ username: string; serverAddress: string; cid: bigint }> => [
        { username: 'ada', serverAddress: 'wss://one', cid: 1n },
      ],
      removeSession: async (username: string, serverAddress: string): Promise<void> => {
        removed.push({ username, serverAddress });
      },
      removeAllSessions: async (): Promise<void> => { cleared += 1; },
      // The dialog reads the list from the agent on open and waits for it
      // (the-account-list-waits-for-its-read); answered at once here.
      reloadStoredSessions: async (): Promise<void> => {},
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
}

describe('removing one saved account', () => {
  beforeEach((): void => { removed.length = 0; cleared = 0; });

  it('does not remove it on the first click', async (): Promise<void> => {
    await open();
    await userEvent.click(await screen.findByLabelText(/Delete saved account ada/i));
    expect(removed).toEqual([]);
  });

  it('removes it once the confirmation is accepted', async (): Promise<void> => {
    // Positive control: the guard must not block a confirmed removal, and the
    // account removed must be the one that was asked about.
    await open();
    await userEvent.click(await screen.findByLabelText(/Delete saved account ada/i));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(removed).toEqual([{ username: 'ada', serverAddress: 'wss://one' }]);
  });
});

describe('clearing every saved account', () => {
  beforeEach((): void => { removed.length = 0; cleared = 0; });

  it('does not clear them on the first click', async (): Promise<void> => {
    await open();
    await userEvent.click(await screen.findByRole('button', { name: /Clear Saved Accounts/i }));
    expect(cleared).toBe(0);
  });
});
