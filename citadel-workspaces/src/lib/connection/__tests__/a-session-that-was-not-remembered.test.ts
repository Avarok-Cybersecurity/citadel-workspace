/**
 * A session the device could not remember has to say so.
 *
 * `storeSession` returns false when the LocalDB write fails, and the header of
 * `session-management` explains why that must not throw: the account exists,
 * the credentials were accepted, and the live session is fine. What the user
 * loses is the NEXT launch -- they will have to sign in again.
 *
 * Nobody was told. The one caller that read the flag wrote a debug line and
 * carried on; the other four discarded it. So "Remember me" could fail
 * completely and the only difference the user saw was a login screen days
 * later, with nothing connecting the two.
 *
 * This is the same shape as `revfs:persist-failed`, which is emitted here and
 * turned into a notice by a mounted component -- library code does not reach
 * for the toaster. The event is emitted through the injected IO router for the
 * same reason.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleAuthSuccess } from '../session-management';
import type { StoredSession } from '@/types/session-types';

interface Harness {
  emitted: Array<{ event: string; data: unknown }>;
  state: Record<string, unknown>;
  io: Record<string, unknown>;
}

function harness(storeFails: boolean): Harness {
  const emitted: Array<{ event: string; data: unknown }> = [];
  const state: Record<string, unknown> = {
    storedSessions: { sessions: [] as StoredSession[] },
    addOrUpdateSession: vi.fn(),
    setCurrentConnectionInfo: vi.fn(),
    updateCurrentConnectionInfo: vi.fn(),
    setStoredSessions: vi.fn(),
    removeSession: vi.fn(),
  };
  const io: Record<string, unknown> = {
    storeSessionsToLocalDB: vi.fn(async (): Promise<void> => {
      if (storeFails) throw new Error('LocalDBSetKV request timed out');
    }),
    loadSessionsFromLocalDB: vi.fn(async (): Promise<null> => null),
    setSelectedUser: vi.fn(async (): Promise<void> => {}),
    setWorkspaceConnectionId: vi.fn(),
    updateConnectionService: vi.fn(),
    emitEvent: vi.fn((event: string, data: unknown): void => { emitted.push({ event, data }); }),
  };
  return { emitted, state, io };
}

const params: Record<string, unknown> = {
  username: 'alice',
  serverAddress: '127.0.0.1:12349',
  fullName: 'Alice',
  cid: 42n,
  securitySettings: undefined,
};

describe('a session the device could not remember', () => {
  it('says so, rather than only writing a debug line', async () => {
    const h: Harness = harness(true);
    await handleAuthSuccess(params as never, h.state as never, h.io as never);

    const notice: { event: string; data: unknown } | undefined =
      h.emitted.find((e) => e.event === 'session:not-remembered');
    expect(notice).toBeDefined();
    expect(notice?.data).toMatchObject({ username: 'alice' });
  });

  it('says nothing when the session WAS remembered', async () => {
    // Negative control. Without this the assertion above passes for a build
    // that announces the failure unconditionally, which is a worse lie than
    // silence -- it would tell every user their session was not saved.
    const h: Harness = harness(false);
    await handleAuthSuccess(params as never, h.state as never, h.io as never);

    expect(h.emitted.map((e) => e.event)).not.toContain('session:not-remembered');
  });
});
