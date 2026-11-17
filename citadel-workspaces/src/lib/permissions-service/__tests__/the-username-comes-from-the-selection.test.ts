/**
 * Reading who this tab is using must not require a saved account to exist.
 *
 * `resolveCurrentUserId` went straight to `getTabSelectedSession`, which reads
 * the tab selection and then calls `findSession(username, serverAddress)`. That
 * answers "which SAVED ACCOUNT is this tab using" and returns null when there is
 * no stored record — and stored sessions hold saved credentials, so a user who
 * declined to save them, or whose store has not loaded yet, has a perfectly good
 * selection and nothing to match it against.
 *
 * Every permission fetch then bails with "nobody is signed in on this tab". CI
 * returned that sentence on the workspace admin's own Edit button through three
 * rounds of fixes to how and when the selection gets WRITTEN — while the thing
 * reading it back was asking for something else entirely.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const world: {
  connectionUsername: string | undefined;
  selection: { selectedUsername?: string; selectedServerAddress?: string } | null;
  storedSession: { username: string } | null;
} = { connectionUsername: undefined, selection: null, storedSession: null };

vi.mock('@/lib/connection', () => ({
  connectionManager: {
    getConnectionInfo: (): unknown =>
      world.connectionUsername === undefined ? null : { cid: 1n, username: world.connectionUsername },
    getTabSelectedSession: async (): Promise<unknown> => world.storedSession,
  },
}));

vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<unknown> => world.selection,
}));

const { resolveCurrentUserId } = await import('../current-user');

beforeEach((): void => {
  world.connectionUsername = undefined;
  world.selection = null;
  world.storedSession = null;
});

describe('who the permissions service is asking on behalf of', () => {
  it('takes the username from the selection when there is no saved account', async () => {
    // The defect. The selection names the user; requiring a stored session to
    // read it back asks a question that can fail on its own.
    world.selection = { selectedUsername: 'alice', selectedServerAddress: 'x:1' };
    world.storedSession = null;

    expect(await resolveCurrentUserId()).toBe('alice');
  });

  it('still prefers the connection record, which is synchronous', async () => {
    // The positive control for the ordering: the connection is checked first
    // precisely so listener comparisons do not depend on an async read.
    world.connectionUsername = 'bob';
    world.selection = { selectedUsername: 'alice', selectedServerAddress: 'x:1' };

    expect(await resolveCurrentUserId()).toBe('bob');
  });

  it('falls back to the stored session when there is no selection', async () => {
    // The other positive control: removing the old path entirely would satisfy
    // the first test and lose the case it was written for.
    world.selection = null;
    world.storedSession = { username: 'carol' };

    expect(await resolveCurrentUserId()).toBe('carol');
  });

  it('is null when nothing knows', async () => {
    expect(await resolveCurrentUserId()).toBeNull();
  });
});
