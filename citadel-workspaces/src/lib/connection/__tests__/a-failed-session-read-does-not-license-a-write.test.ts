/**
 * A session list that could not be READ must not be written back.
 *
 * `citadel_sessions` is one LocalDB key holding every remembered account, and
 * `storeSessionsToLocalDB` writes the whole thing. That is sound only when the
 * list in memory came from the key. If the read failed — timed out, socket
 * down, storage denied — the list is empty for a reason unrelated to what is
 * stored, and writing it deletes every remembered account. Silently, because
 * the write itself succeeds.
 *
 * Round 596 narrowed two of these writes to a single-session upsert
 * (`persist-one-session.ts`) and left FIVE whole-list writers behind, in
 * `session-list.ts` (x2), `session-management.ts` (x2) and `service.ts`. That
 * is the shape this repository keeps recording — a correct fix applied in some
 * of the places its mechanism appears — and it is the shape that fix had.
 *
 * So the guard is on `storeSessionsToLocalDB`, the one method all five call,
 * and this file drives the REAL `ConnectionIOWebSocket` over a faked socket.
 * The sibling tests build a plain object literal for `io`, which is right for
 * what they test and means none of them can see this.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StoredSessions } from '@/types/session-types';

const stored: Map<string, number[]> = new Map<string, number[]>();
let getBehaviour: 'absent' | 'timeout' | 'stored' = 'absent';

vi.mock('../../websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: async (_cid: bigint, key: string): Promise<{ value: number[] } | null> => {
      if (getBehaviour === 'timeout') throw new Error('LocalDB request timed out after 5000ms');
      const value: number[] | undefined = stored.get(key);
      if (value === undefined) throw new Error(`Key not found: ${key}`);
      return { value };
    },
    sendLocalDBSet: async (_cid: bigint, key: string, value: number[]): Promise<void> => {
      stored.set(key, value);
    },
  },
}));

import { ConnectionIOWebSocket } from '../io-websocket';
import { resetSessionReadTracking } from '../sessions-read-state';
import { isGenuinelyAbsent } from '@/lib/storage/absence';
import { markSessionsRead } from '../sessions-read-state';
import { SESSION_STORAGE_KEY } from '@/types/session-types';

const twoAccounts: StoredSessions = {
  sessions: [
    { username: 'alice', serverAddress: 'srv' },
    { username: 'bob', serverAddress: 'srv' },
  ],
} as unknown as StoredSessions;

function namesOnDisk(): string[] | null {
  const raw: number[] | undefined = stored.get(SESSION_STORAGE_KEY);
  if (!raw) return null;
  const parsed: StoredSessions = JSON.parse(new TextDecoder().decode(new Uint8Array(raw))) as StoredSessions;
  return parsed.sessions.map((s) => s.username).sort();
}

/** What every caller of the loader does: read, then classify what went wrong. */
async function loadClassifying(io: ConnectionIOWebSocket): Promise<'ok' | 'absent' | 'failed'> {
  try {
    await io.loadSessionsFromLocalDB();
    return 'ok';
  } catch (error) {
    if (isGenuinelyAbsent(error)) { markSessionsRead(); return 'absent'; }
    return 'failed';
  }
}

describe('the stored-session list', () => {
  let io: ConnectionIOWebSocket;

  beforeEach(() => {
    stored.clear();
    getBehaviour = 'absent';
    resetSessionReadTracking();
    io = new ConnectionIOWebSocket();
  });

  it('is not overwritten when the read failed', async () => {
    stored.set(
      SESSION_STORAGE_KEY,
      Array.from(new TextEncoder().encode(JSON.stringify(twoAccounts))),
    );
    getBehaviour = 'timeout';

    expect(await loadClassifying(io)).toBe('failed');
    await expect(
      io.storeSessionsToLocalDB({ sessions: [] } as unknown as StoredSessions),
    ).rejects.toThrow(/never successfully read/);

    expect(namesOnDisk(), 'both accounts must still be remembered').toEqual(['alice', 'bob']);
  });

  it('is not written before any read has happened at all', async () => {
    await expect(
      io.storeSessionsToLocalDB({ sessions: [] } as unknown as StoredSessions),
    ).rejects.toThrow(/never successfully read/);
    expect(namesOnDisk()).toBeNull();
  });

  it('IS written when the key genuinely holds nothing', async () => {
    // The discrimination that makes the guard worth having rather than merely
    // safe: a first-run user has nothing stored, and their first sign-in must
    // still be remembered.
    expect(await loadClassifying(io)).toBe('absent');
    await expect(io.storeSessionsToLocalDB(twoAccounts)).resolves.toBeUndefined();
    expect(namesOnDisk()).toEqual(['alice', 'bob']);
  });

  it('IS written after a read that returned the list', async () => {
    stored.set(
      SESSION_STORAGE_KEY,
      Array.from(new TextEncoder().encode(JSON.stringify(twoAccounts))),
    );
    getBehaviour = 'stored';

    expect(await loadClassifying(io)).toBe('ok');
    await expect(
      io.storeSessionsToLocalDB({
        sessions: [...twoAccounts.sessions, { username: 'carol', serverAddress: 'srv' }],
      } as unknown as StoredSessions),
    ).resolves.toBeUndefined();

    expect(namesOnDisk()).toEqual(['alice', 'bob', 'carol']);
  });
});
