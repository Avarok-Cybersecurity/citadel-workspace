/**
 * A stored session with no server (records older than the server field) reconnects
 * naming the server the agent reports for that account, and the record is backfilled.
 * When the agent cannot say, nothing is guessed and nothing retried: the account is
 * handed to a sign-in and the attempt ends with StoredServerUnknown.
 *
 * The agent signs in only the account of that username on the server a Connect names,
 * so an empty one would be refused every time -- and the reconnect paths retried with
 * backoff on a request that could never succeed.
 *
 * Real: ConnectionState, storeSession / removeSession and the per-session persistence.
 * Doubled: the LocalDB key (an in-memory disk) and the agent's account list -- the I/O.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StoredSession, StoredSessions } from '@/types/session-types';
import type { AccountHost } from '@/lib/admission/account-servers';
import type { ConnectionIO } from '../io';
import { ConnectionState } from '../state';
import { markSessionsRead } from '../sessions-read-state';
import { StoredServerUnknown, storedSessionServer } from '../stored-server';
import { connectionStoredServerIO } from '../stored-server-io';
import { signInNeededFor } from '@/lib/sessions/sign-in-needed';

const BENCH: string = 'bench.work.avarok.net';
let disk: StoredSessions;
let agent: () => Promise<AccountHost[]>;
let asked: number;

const io: ConnectionIO = {
  loadSessionsFromLocalDB: async (): Promise<StoredSessions> => ({ sessions: [...disk.sessions] }),
  storeSessionsToLocalDB: async (sessions: StoredSessions): Promise<void> => { disk = { sessions: [...sessions.sessions] }; },
  agentAccounts: (): Promise<AccountHost[]> => { asked += 1; return agent(); },
  emitEvent: (): void => undefined,
} as unknown as ConnectionIO;

const legacy: () => StoredSession = (): StoredSession => ({ username: 'alice', serverAddress: '', fullName: 'Alice' }) as unknown as StoredSession;

function stateWith(session: StoredSession): ConnectionState {
  const state: ConnectionState = new ConnectionState((): boolean => true);
  state.setStoredSessions({ sessions: [session] });
  disk = { sessions: [{ ...session }] };
  return state;
}

beforeEach(() => { asked = 0; markSessionsRead(); signInNeededFor.set(null); });
afterEach(() => { signInNeededFor.set(null); });

describe('a stored session without a server', () => {
  it('names the agent’s server for the account, and the record keeps it', async () => {
    agent = async (): Promise<AccountHost[]> => [{ username: 'bob', server: 'acme.work.avarok.net' }, { username: 'alice', server: BENCH }];
    const session: StoredSession = legacy();
    const state: ConnectionState = stateWith(session);

    expect(await storedSessionServer(session, connectionStoredServerIO(state, io))).toBe(BENCH);

    // Backfilled, on disk and in memory, and the serverless entry is gone from both.
    expect(disk.sessions.map((s) => [s.username, s.serverAddress])).toEqual([['alice', BENCH]]);
    expect(state.storedSessions.sessions.map((s) => s.serverAddress)).toEqual([BENCH]);
    expect(session.serverAddress).toBe(BENCH);
    expect(signInNeededFor.get()).toBeNull();
  });

  it('a record that has a server is not looked up', async () => {
    agent = async (): Promise<AccountHost[]> => [{ username: 'alice', server: 'acme.work.avarok.net' }];
    const session: StoredSession = { ...legacy(), serverAddress: BENCH } as StoredSession;
    expect(await storedSessionServer(session, connectionStoredServerIO(stateWith(session), io))).toBe(BENCH);
    expect(asked).toBe(0);
  });

  it('when the agent cannot answer: a sign-in for the account, no guess, no backfill', async () => {
    agent = async (): Promise<AccountHost[]> => { throw new Error('GetAccountInformation timed out'); };
    const session: StoredSession = legacy();
    const state: ConnectionState = stateWith(session);

    await expect(storedSessionServer(session, connectionStoredServerIO(state, io))).rejects.toBeInstanceOf(StoredServerUnknown);
    expect(signInNeededFor.get()).toBe('alice');
    expect(disk.sessions.map((s) => s.serverAddress)).toEqual(['']);
  });

  it('when the agent holds no such account: the same', async () => {
    agent = async (): Promise<AccountHost[]> => [{ username: 'bob', server: BENCH }];
    const session: StoredSession = legacy();
    await expect(storedSessionServer(session, connectionStoredServerIO(stateWith(session), io))).rejects.toBeInstanceOf(StoredServerUnknown);
    expect(signInNeededFor.get()).toBe('alice');
  });
});
