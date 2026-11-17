/**
 * The background reconnect of a stored session with no server names the agent's
 * server for the account; when the agent cannot say, it stops -- no backoff on a
 * Connect the agent would refuse every time -- and hands the account to a sign-in.
 *
 * Doubled: the socket's connect (counted), the agent's account list
 * (GetAccountInformation) and the connection manager's store -- the I/O seams.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredSession } from '@/types/session-types';
import type { AccountHost } from '@/lib/admission/account-servers';
import type { ConnectionAttempt } from '../types';

const h: { connects: string[]; agent: () => Promise<AccountHost[]>; stored: StoredSession[]; removed: string[] } = vi.hoisted(() => ({
  connects: [] as string[], agent: async () => [], stored: [] as StoredSession[], removed: [] as string[],
}));

vi.mock('@/lib/websocket-service', () => ({
  websocketService: { connect: async (_id: string, _user: string, server: string): Promise<void> => { h.connects.push(server); } },
}));
vi.mock('@/lib/stored-accounts', () => ({ askStoredAccounts: (): Promise<AccountHost[]> => h.agent() }));
vi.mock('@/lib/connection', () => ({
  connectionManager: {
    storeSession: async (s: StoredSession): Promise<void> => { h.stored.push(s); },
    removeSession: async (u: string, server: string): Promise<void> => { h.removed.push(`${u}@${server}`); },
  },
}));

const { attemptReconnect } = await import('../reconnect-logic');
const { signInNeededFor } = await import('@/lib/sessions/sign-in-needed');

const KEY: string = 'alice@';
const record: () => StoredSession = (): StoredSession => ({ username: 'alice', serverAddress: '', password: 'p' }) as unknown as StoredSession;
let attempts: Map<string, ConnectionAttempt>;

beforeEach(() => {
  Object.assign(h, { connects: [], stored: [], removed: [] });
  attempts = new Map([[KEY, { sessionKey: KEY, attempts: 0, timeout: null }]]);
  signInNeededFor.set(null);
});
afterEach(() => {
  const pending: ConnectionAttempt | undefined = attempts.get(KEY);
  if (pending?.timeout) clearTimeout(pending.timeout);
});

describe('a background reconnect of a record with no server', () => {
  it('names the server the agent reports, and backfills the record', async () => {
    h.agent = async (): Promise<AccountHost[]> => [{ username: 'alice', server: 'bench.work.avarok.net' }];
    await attemptReconnect(attempts, KEY, record());
    expect(h.connects).toEqual(['bench.work.avarok.net']);
    expect(h.stored.map((s) => s.serverAddress)).toEqual(['bench.work.avarok.net']);
    expect(h.removed).toEqual(['alice@']);
  });

  it('when the agent cannot say: no Connect, no retry, and a sign-in for the account', async () => {
    h.agent = async (): Promise<AccountHost[]> => { throw new Error('GetAccountInformation timed out'); };
    await attemptReconnect(attempts, KEY, record());
    expect(h.connects).toEqual([]);
    expect(attempts.get(KEY)?.timeout).toBeNull();
    // Kept, so the scheduler does not pick it up again.
    expect(attempts.has(KEY)).toBe(true);
    expect(signInNeededFor.get()).toBe('alice');
  });
});
