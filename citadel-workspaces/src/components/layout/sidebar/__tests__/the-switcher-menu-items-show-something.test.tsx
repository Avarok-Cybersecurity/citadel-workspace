/**
 * The three account items in the workspace switcher put something on screen.
 *
 * Reported as "I click Root Workspace, then Add another account / Join New
 * Workspace / Manage Accounts, and I see nothing on the screen." Two separate
 * causes, one symptom:
 *
 * 1. Manage Accounts ran `setIsOpen(false)` and nothing else. The only mount of
 *    `AccountManagementDialog` in the app was `ManageAccountsButton`, which the
 *    Landing page renders — so from inside a workspace the item was inert.
 *
 * 2. The other two opened the join wizard inside a Radix `<DialogContent>`.
 *    `ServerConnect`, `SecuritySettings` and `Join` are each already a
 *    full-screen `position: fixed` overlay with their own scrim. A transformed
 *    ancestor becomes the containing block for a fixed descendant, and
 *    `DialogContent` is `translate-x-[-50%] translate-y-[-50%]` — so `inset-0`
 *    resolved to the panel, not the viewport. The panel itself is `display:
 *    grid` whose only children are out of flow, so it measures ZERO pixels
 *    tall, and `overflow-y-auto` on it clips.
 *
 *    Measured in Chromium on the exact class-derived CSS: DialogContent 576x0,
 *    the step's own scrim 576x32, the card 448x420 with 0 visible pixels, and
 *    `elementFromPoint` at the viewport centre returning the black/80 backdrop.
 *    A dimmed screen and nothing else — precisely what was reported.
 *
 * jsdom does no layout, so neither of those geometric facts is assertable here.
 * What IS assertable is the structural cause: a self-scrimming step must be the
 * OUTERMOST dialog. Nesting one modal inside another is the defect, and it is
 * the thing that flips when the wrapper is removed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmDialogProvider } from '@/components/shared/confirm-dialog';
import { WorkspaceSwitcher } from '../WorkspaceSwitcher';

const SESSIONS: Array<{ username: string; serverAddress: string; cid: bigint; fullName: string }> = [
  { username: 'ada', serverAddress: 'one.example.com:12349', cid: 1n, fullName: 'Ada L' },
  { username: 'bob', serverAddress: 'one.example.com:12349', cid: 2n, fullName: 'Bob K' },
];

vi.mock('@/lib/connection', async (importOriginal) => {
  const actual: { connectionManager: Record<string, unknown> } = await importOriginal();
  // Object.create, not a spread: connectionManager is a class instance and its
  // methods live on the prototype. Same reason as removing-an-account-asks-first.
  return {
    ...actual,
    connectionManager: Object.assign(Object.create(actual.connectionManager as object), {
      getStoredSessions: (): { sessions: typeof SESSIONS } => ({ sessions: SESSIONS }),
      getStoredSessionsArray: (): typeof SESSIONS => SESSIONS,
      getConnectionInfo: (): { cid: bigint } => ({ cid: 1n }),
      getActiveSessionsResult: async (): Promise<{ ok: boolean; sessions: []; signedOut: [] }> => ({ ok: true, sessions: [], signedOut: [] }),
    }),
  };
});

vi.mock('@/lib/connection-service', () => ({
  ConnectionService: { getInstance: (): { onConnectionChange: () => () => void } => ({
    onConnectionChange: (): (() => void) => (): void => {},
  }) },
}));

vi.mock('@/lib/tab-context', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return {
    ...actual,
    getSelectedUser: async (): Promise<{ selectedUsername: string; selectedServerAddress: string }> =>
      ({ selectedUsername: 'ada', selectedServerAddress: 'one.example.com:12349' }),
  };
});

vi.mock('@/hooks/use-toast', () => ({
  useToast: (): { toast: () => void } => ({ toast: (): void => {} }),
}));

async function openMenu(): Promise<void> {
  render(
    <MemoryRouter>
      <ConfirmDialogProvider>
        <WorkspaceSwitcher workspaceName="Root Workspace" />
      </ConfirmDialogProvider>
    </MemoryRouter>,
  );
  await userEvent.click(await screen.findByTestId('workspace-switcher'));
}

/**
 * The dialogs an ELEMENT sits inside, itself excluded.
 *
 * A step overlay with any of these is the bug: its `position: fixed` is being
 * resolved against another dialog's transformed panel rather than the viewport.
 */
function enclosingDialogs(element: HTMLElement): string[] {
  const names: string[] = [];
  let node: HTMLElement | null = element.parentElement;
  while (node) {
    if (node.getAttribute('role') === 'dialog') {
      names.push(node.getAttribute('aria-label') ?? node.className);
    }
    node = node.parentElement;
  }
  return names;
}

describe('Manage Accounts', () => {
  beforeEach((): void => { vi.clearAllMocks(); });

  it('opens the account manager', async (): Promise<void> => {
    await openMenu();
    await userEvent.click(await screen.findByText('Manage Accounts'));
    expect(await screen.findByRole('dialog', { name: /Manage Accounts/i })).toBeTruthy();
  });
});

describe('Join New Workspace', () => {
  beforeEach((): void => { vi.clearAllMocks(); });

  it('shows the first wizard step', async (): Promise<void> => {
    await openMenu();
    await userEvent.click(await screen.findByText('Join New Workspace'));
    // Positive control: without this the assertion below would be vacuously
    // true against a locator that never matched anything.
    expect(await screen.findByRole('dialog', { name: 'Connect to a server' })).toBeTruthy();
  });

  it('shows it as the outermost dialog, not nested in one', async (): Promise<void> => {
    await openMenu();
    await userEvent.click(await screen.findByText('Join New Workspace'));
    const step: HTMLElement = await screen.findByRole('dialog', { name: 'Connect to a server' });
    expect(enclosingDialogs(step)).toEqual([]);
  });
});

describe('Add another account', () => {
  beforeEach((): void => { vi.clearAllMocks(); });

  it('shows the first wizard step, targeted at that workspace', async (): Promise<void> => {
    await openMenu();
    await userEvent.click(await screen.findByText('Add another account'));
    const step: HTMLElement = await screen.findByRole('dialog', { name: 'Connect to a server' });
    expect(enclosingDialogs(step)).toEqual([]);
    // The step it opens is aimed at the workspace whose group was clicked --
    // the address arrives as `defaultServer` and pre-fills the field. Asserted
    // on the field rather than the heading, because the heading falls back to
    // the username when no workspace name has been stored yet.
    const address: HTMLInputElement = screen.getByTestId('server-address-input');
    expect(address.value).toBe('one.example.com:12349');
  });
});
