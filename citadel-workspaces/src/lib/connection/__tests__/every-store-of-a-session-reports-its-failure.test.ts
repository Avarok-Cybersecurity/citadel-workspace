/**
 * Four callers beyond handleAuthSuccess (the CID update on connect, both
 * reconnect paths, and the service method) awaited `storeSession` and dropped
 * the boolean, so a failed write was reported only when the login path
 * happened to be the one that failed. The report now lives in storeSession.
 */
import { describe, it, expect, vi } from 'vitest';
import { storeSession } from '../session-management';
import type { StoredSession } from '@/types/session-types';

interface World { emitted: Array<{ event: string; data: unknown }>; state: never; io: never }

function world(storeFails: boolean): World {
  const emitted: Array<{ event: string; data: unknown }> = [];
  const state: Record<string, unknown> = {
    storedSessions: { sessions: [] as StoredSession[] },
    addOrUpdateSession: vi.fn(),
  };
  const io: Record<string, unknown> = {
    storeSessionsToLocalDB: vi.fn(async (): Promise<void> => { if (storeFails) throw new Error('timed out'); }),
    loadSessionsFromLocalDB: vi.fn(async (): Promise<null> => null),
    emitEvent: vi.fn((event: string, data: unknown): void => { emitted.push({ event, data }); }),
  };
  return { emitted, state: state as never, io: io as never };
}

const session: StoredSession = { username: 'alice', serverAddress: '127.0.0.1:12349', fullName: 'Alice', cid: 42n } as unknown as StoredSession;

describe('storeSession', () => {
  it('tells the user when the session could not be saved, whoever asked', async () => {
    const w: World = world(true);
    await storeSession(session, w.state, w.io);
    expect(w.emitted).toEqual([{ event: 'session:not-remembered', data: { username: 'alice' } }]);
  });

  it('says nothing when it was saved', async () => {
    const w: World = world(false);
    await storeSession(session, w.state, w.io);
    expect(w.emitted).toEqual([]);
  });
});
