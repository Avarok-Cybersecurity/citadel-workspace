/**
 * The signed-in person is named from the workspace roster, not the login name.
 *
 * Registration saved the full name on the stored session, so a freshly
 * registered tab said "Alice Chen"; after a reload or a password sign-in the
 * saved session had none and the top bar, the switcher and the chat said
 * "alice0924", or nothing. The roster is loaded on every sign-in path.
 *
 * Mocked: the tab selection and saved-session reads (IndexedDB I/O).
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { WorkspaceProvider, type WorkspaceState } from '@/contexts/WorkspaceContext';
import type { User } from '@/types/workspace-entities';
import { rosterDisplayName } from '@/lib/roster-display-name';

vi.mock('@/lib/tab-context', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  getSelectedUser: async (): Promise<{ selectedUsername: string; selectedCid: bigint }> => ({ selectedUsername: 'alice0924', selectedCid: 7n }),
}));
vi.mock('@/lib/connection', () => ({
  // A password sign-in: the saved session knows no full name.
  connectionManager: { getTabSelectedSession: async (): Promise<null> => null, getConnectionInfo: (): null => null },
}));

import { useSelfName } from '../use-self-name';

function member(username: string, displayName: string): User {
  return { id: username, username, displayName, isOnline: true } as User;
}

function withRoster(
  members: Record<string, User>,
  currentUser?: { id: string; username: string; name: string },
): (p: { children: ReactNode }) => JSX.Element {
  const state: WorkspaceState = { members, currentUser, nodes: {}, loading: { workspace: false, members: false, nodes: false } } as unknown as WorkspaceState;
  return ({ children }: { children: ReactNode }): JSX.Element => <WorkspaceProvider state={state}>{children}</WorkspaceProvider>;
}

describe('the signed-in person', () => {
  it('is called what the roster calls them after a password sign-in', async () => {
    const { result } = renderHook(() => useSelfName(), {
      wrapper: withRoster({ alice0924: member('alice0924', 'Alice Chen') }),
    });
    await waitFor(() => expect(result.current.name).toBe('Alice Chen'));
    expect(result.current.username).toBe('alice0924');
  });

  // The live defect: a workspace load writes `name: fullName || username`, so
  // after a password sign-in `currentUser.name` IS the username -- and it was
  // read first, so the roster's "Alice Anders" never got a look in.
  it('is called what the roster calls them when the loaded user is named by username', async () => {
    const { result } = renderHook(() => useSelfName(), {
      wrapper: withRoster(
        { alice0924: member('alice0924', 'Alice Anders') },
        { id: 'alice0924', username: 'alice0924', name: 'alice0924' },
      ),
    });
    await waitFor(() => expect(result.current.name).toBe('Alice Anders'));
  });

  it('keeps a name the loaded user carries that is not the username', async () => {
    const { result } = renderHook(() => useSelfName(), {
      wrapper: withRoster(
        { alice0924: member('alice0924', 'Alice Anders') },
        { id: 'alice0924', username: 'alice0924', name: 'Alice Renamed' },
      ),
    });
    await waitFor(() => expect(result.current.name).toBe('Alice Renamed'));
  });

  it('falls back to the username when the roster has not loaded', async () => {
    const { result } = renderHook(() => useSelfName(), { wrapper: withRoster({}) });
    await waitFor(() => expect(result.current.name).toBe('alice0924'));
  });
});

describe('a peer', () => {
  it('is named from the roster when it knows them, and not otherwise', () => {
    const roster: Record<string, User> = { bob0924: member('bob0924', 'Bob Stone'), carol: member('carol', 'carol') };
    expect(rosterDisplayName(roster, 'bob0924')).toBe('Bob Stone');
    expect(rosterDisplayName(roster, 'carol')).toBeUndefined();
    expect(rosterDisplayName(roster, 'dave')).toBeUndefined();
  });

  // Measured live, switching orgs: the account button kept the previous org's user
  // ("alice.lab") because the loaded currentUser was read before this tab's identity.
  it('is the tab\'s own account, not a loaded user left over from another workspace', async () => {
    const { result } = renderHook(() => useSelfName(), {
      wrapper: withRoster(
        { alice0924: member('alice0924', 'Alice Anders') },
        { id: 'alice.lab', username: 'alice.lab', name: 'Lab Alice' },
      ),
    });
    await waitFor(() => expect(result.current.username).toBe('alice0924'));
    expect(result.current.name).toBe('Alice Anders');
  });
});
