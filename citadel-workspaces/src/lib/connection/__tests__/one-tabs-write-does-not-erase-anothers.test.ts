/**
 * A tab writing one session must not erase the sessions other tabs stored.
 *
 * `citadel_sessions` is a single LocalDB key holding every remembered account,
 * and each tab holds its own `ConnectionState` with its own in-memory array,
 * loaded once at init. Both writers pushed that whole array to the shared key,
 * so a tab persisted its view of the world over everyone else's.
 *
 * Not a rare race: `updateSessionRole` runs on every `members:loaded`, which
 * fires at boot and on every node open. So opening a room in one tab was enough
 * to delete an account another tab had just signed into — from disk, silently,
 * discovered only at the next browser launch when it was not remembered.
 *
 * The two tabs here are two `ConnectionState`s over one fake LocalDB, which is
 * exactly the real topology. Assertions are on what is left ON DISK, because
 * that is the thing that survives the reload.
 *
 * Both operations are asserted in both directions. Merging on write alone would
 * make removal impossible — a delete undone by the next tab's upsert — so the
 * removal cases are not decoration, they are the half that stops the fix from
 * being wrong in the other direction.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { StoredSession, StoredSessions } from '@/types/session-types';
import { persistSessionUpsert, persistSessionRemoval } from '../persist-one-session';
import type { ConnectionIO } from '../io';

/** The one shared key, as both tabs see it. */
let disk: StoredSessions | null = null;
let readFails: Error | null = null;

const io: ConnectionIO = {
  loadSessionsFromLocalDB: async (): Promise<StoredSessions | null> => {
    if (readFails) throw readFails;
    return disk === null ? null : { sessions: [...disk.sessions] };
  },
  storeSessionsToLocalDB: async (sessions: StoredSessions): Promise<void> => {
    disk = { sessions: [...sessions.sessions] };
  },
} as unknown as ConnectionIO;

const account = (username: string): StoredSession =>
  ({ username, serverAddress: 'srv', role: 'Member' }) as unknown as StoredSession;

const names = (): string[] => (disk?.sessions ?? []).map((s) => s.username).sort();

describe('two tabs sharing one session key', () => {
  beforeEach(() => {
    disk = { sessions: [] };
    readFails = null;
  });

  it('keeps an account tab 2 stored when tab 1 writes its stale list', async () => {
    // Tab 1 booted with [A] and has never heard of B.
    const tabOneMemory: StoredSessions = { sessions: [account('A')] };
    disk = { sessions: [account('A')] };

    // Tab 2 signs in B.
    await persistSessionUpsert(account('B'), { sessions: [account('A'), account('B')] }, io);
    expect(names()).toEqual(['A', 'B']);

    // Tab 1 opens a node: members:loaded -> updateSessionRole -> storeSession.
    await persistSessionUpsert(account('A'), tabOneMemory, io);

    expect(names()).toEqual(['A', 'B']);
  });

  it('still records a new account, which is what storing is for', async () => {
    // The control. A writer that never wrote anything would pass the test above
    // and lose every session at the moment it was authenticated.
    await persistSessionUpsert(account('A'), { sessions: [] }, io);

    expect(names()).toEqual(['A']);
  });

  it('still updates an account that is already stored', async () => {
    disk = { sessions: [account('A')] };
    const updated: StoredSession = { ...account('A'), role: 'Admin' } as StoredSession;

    await persistSessionUpsert(updated, { sessions: [updated] }, io);

    expect(disk?.sessions).toHaveLength(1);
    expect(disk?.sessions[0].role).toBe('Admin');
  });

  it('removes only the account asked for, leaving another tab\'s alone', async () => {
    disk = { sessions: [account('A'), account('B')] };

    // Tab 1 knows only about A and signs out of it.
    await persistSessionRemoval('A', 'srv', { sessions: [] }, io);

    expect(names()).toEqual(['B']);
  });

  it('does not resurrect an account another tab removed', async () => {
    // The direction a merge-on-write fix would get wrong: tab 2 removes B, then
    // tab 1 upserts A from a memory that still lists both.
    disk = { sessions: [account('A'), account('B')] };
    await persistSessionRemoval('B', 'srv', { sessions: [account('A')] }, io);
    expect(names()).toEqual(['A']);

    await persistSessionUpsert(account('A'), { sessions: [account('A'), account('B')] }, io);

    expect(names()).toEqual(['A']);
  });

  it('writes NOTHING when the key could not be read', async () => {
    // The first version of this fell back to the tab's in-memory list, which is
    // exactly the whole-list write this module removes -- a timeout would have
    // clobbered the accounts it exists to protect, while reporting success.
    //
    // Not writing costs the ability to reconnect automatically next time, which
    // `storeSession`'s own contract already says it may cost. Writing the wrong
    // list costs somebody else's stored account, permanently and silently.
    disk = { sessions: [account('A')] };
    readFails = new Error('LocalDB request timed out after 5000ms');

    await expect(
      persistSessionUpsert(account('B'), { sessions: [account('A'), account('B')] }, io),
    ).rejects.toThrow(/timed out/);

    expect(names()).toEqual(['A']);
  });

  it('removes nothing when the key could not be read', async () => {
    // Same rule on the other operation: a failed read must not turn a removal
    // into a whole-list write either.
    disk = { sessions: [account('A'), account('B')] };
    readFails = new Error('LocalDB request timed out after 5000ms');

    await expect(persistSessionRemoval('A', 'srv', { sessions: [] }, io)).rejects.toThrow(
      /timed out/,
    );

    expect(names()).toEqual(['A', 'B']);
  });

  it('treats a genuinely absent key as an empty disk, so a first write works', async () => {
    // The control for the two above. A module that refused on every read error
    // would satisfy both and break the very first session ever stored, when the
    // key legitimately does not exist.
    disk = null;
    readFails = new Error('Key not found');

    await persistSessionUpsert(account('A'), { sessions: [account('A')] }, io);

    expect(names()).toEqual(['A']);
  });
});
