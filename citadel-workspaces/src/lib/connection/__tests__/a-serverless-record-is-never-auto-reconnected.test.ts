/**
 * The tab's own auto-reconnect (reconnect.ts) only rejoins a session the agent still holds.
 * Nothing on this device can sign one back in: no credential is kept, so a stored record that
 * still carries a `password` from an earlier build is never used to send a Connect, and nothing
 * is scheduled to try again. It reconnects only the session the tab selected by username AND a
 * non-empty server.
 *
 * Real: autoReconnect and ConnectionState. Doubled: the tab's stored selection, the agent's
 * session list and the socket (every request it is asked to send is recorded).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionInformation } from 'citadel-workspace-client-ts';
import type { StoredSession } from '@/types/session-types';
import type { TabSelectionContext } from '../types';
import type { ConnectionIO } from '../io';
import { ConnectionState } from '../state';
import { autoReconnect } from '../reconnect';

const SERVER: string = 'bench.work.avarok.net';
let selection: TabSelectionContext | null;
const sent: string[] = [];
const recordSend = (what: string) => async (): Promise<void> => { sent.push(what); };
// Every way the io could reach the agent with a sign-in records itself; a shape it lacks cannot be called.
const io: ConnectionIO = {
  getSelectedUser: async (): Promise<TabSelectionContext | null> => selection,
  connect: recordSend('connect'),
  sendWebSocketMessage: recordSend('message'),
  executeIntent: recordSend('intent'),
  waitForHealthy: async (): Promise<void> => undefined,
  updateConnectionService: (): void => undefined,
  broadcastConnectionStatus: (): void => undefined,
  emitEvent: (): void => undefined,
  loadSessionsFromLocalDB: async () => ({ sessions: [] }),
  storeSessionsToLocalDB: async (): Promise<void> => undefined,
} as unknown as ConnectionIO;

// What an earlier build wrote: a password beside the record. This build's type has no such field.
const record = (serverAddress: string): StoredSession => ({ username: 'alice', serverAddress, password: 'p' }) as unknown as StoredSession;

function leaderWith(session: StoredSession): ConnectionState {
  const state: ConnectionState = new ConnectionState((): boolean => true);
  state.setStoredSessions({ sessions: [session] });
  return state;
}

beforeEach(() => { sent.length = 0; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('auto-reconnect and a stored record', () => {
  it('a selection without a server reconnects nothing and schedules nothing', async () => {
    selection = { selectedUsername: 'alice', selectedServerAddress: '' } as TabSelectionContext;
    await autoReconnect([], leaderWith(record('')), io, async () => [], async () => undefined);
    expect(sent).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never signs in with a password a record still carries, and schedules no retry', async () => {
    selection = { selectedUsername: 'alice', selectedServerAddress: SERVER } as TabSelectionContext;
    const rejoined: bigint[] = [];
    await autoReconnect([], leaderWith(record(SERVER)), io, async () => [], async (cid: bigint): Promise<void> => { rejoined.push(cid); });
    expect(sent).toEqual([]);
    expect(rejoined).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejoins the session when the agent still holds it (the test can see a rejoin)', async () => {
    selection = { selectedUsername: 'alice', selectedServerAddress: SERVER } as TabSelectionContext;
    const live: SessionInformation = { cid: 7n, username: 'alice', server_address: SERVER } as unknown as SessionInformation;
    const rejoined: bigint[] = [];
    await autoReconnect([live], leaderWith(record(SERVER)), io, async () => [live], async (cid: bigint): Promise<void> => { rejoined.push(cid); });
    expect(rejoined).toEqual([7n]);
    expect(sent).toEqual([]);
  });
});
