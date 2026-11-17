/**
 * One failed session query must not disable auto-reconnect for ever.
 *
 * `reconnectAttempts` had exactly one delete path — `cancelRetry`, reached only
 * from `applyConnectionSuccess` on `ConnectSuccess`. Two things fed it entries
 * that could never be removed:
 *
 *  - the poll used `getActiveSessions()`, which returns `[]` when the request
 *    FAILS. Its own contract says "failure does NOT mean there are no
 *    sessions". So one GetSessions timeout made every stored session look
 *    inactive and scheduled a reconnect for all of them;
 *  - each of those is answered `SessionAlreadyActive` by the agent, which was
 *    not listened for at all, and `ConnectFailure` only logged.
 *
 * After that, `if (reconnectAttempts.has(sessionKey)) continue` skipped every
 * account for the life of the tab: nothing reconnected until logout, a leader
 * change, or the user toggling the setting off and on.
 *
 * These drive the real `reconnectToDisconnectedSessions` over a faked connection
 * manager, because the defect is in what it does with a failed answer rather
 * than in any single function's return value.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StoredSession, StoredSessions } from '@/types/session-types';
import type { ActiveSessionsResult } from '@/lib/connection/queries';

let queryResult: ActiveSessionsResult = { ok: true, sessions: [], signedOut: [] };
const stored: StoredSessions = {
  sessions: [
    { username: 'alice', serverAddress: 'srv', password: 'p' },
    { username: 'bob', serverAddress: 'srv', password: 'p' },
  ],
} as unknown as StoredSessions;

vi.mock('@/lib/connection', () => ({
  connectionManager: {
    getStoredSessions: (): StoredSessions => stored,
    invalidateSessionCache: (): void => {},
    getActiveSessionsResult: async (): Promise<ActiveSessionsResult> => queryResult,
    getActiveSessions: async (): Promise<unknown[]> => queryResult.sessions,
  },
}));
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { isLeader: true }) };
});

const { reconnectToDisconnectedSessions } = await import('../reconnect-logic');

describe('the reconnect poll', () => {
  let scheduled: string[];
  let attempts: Map<string, unknown>;

  beforeEach(() => {
    scheduled = [];
    attempts = new Map<string, unknown>();
    queryResult = { ok: true, sessions: [], signedOut: [] };
  });

  const run = (): Promise<void> =>
    reconnectToDisconnectedSessions(
      true,
      attempts as never,
      new Set<string>(),
      (key: string, _session: StoredSession): void => {
        scheduled.push(key);
        attempts.set(key, {});
      },
    );

  it('schedules nothing when the session query failed', async () => {
    queryResult = { ok: false, sessions: [], signedOut: [] };
    await run();
    expect(
      scheduled,
      'a failed query is not evidence that nothing is connected',
    ).toEqual([]);
  });

  it('still schedules when the query genuinely reports nothing active', async () => {
    // The discrimination. A poll that scheduled nothing on both answers would
    // be safe and useless — auto-reconnect would never fire at all.
    queryResult = { ok: true, sessions: [], signedOut: [] };
    await run();
    expect(scheduled.sort()).toEqual(['alice@srv', 'bob@srv']);
  });

  it('skips a session the query reports as already active', async () => {
    queryResult = {
      ok: true,
      sessions: [{ username: 'alice', server_address: 'srv' }],
    } as unknown as ActiveSessionsResult;
    await run();
    expect(scheduled).toEqual(['bob@srv']);
  });
});
