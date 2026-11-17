/**
 * The tab's own auto-reconnect (reconnect.ts) never reaches a stored record without a server,
 * so it can never send a Connect naming none or retry one: it reconnects only the session the
 * tab selected by username AND a non-empty server. This is why reconnect.ts carries no
 * stored-server resolution (the paths that can reach such a record do: lifecycle.ts,
 * reconnect-logic.ts).
 *
 * Real: autoReconnect and ConnectionState. Doubled: the tab's stored selection and the socket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredSession } from '@/types/session-types';
import type { TabSelectionContext } from '../types';
import type { ConnectionIO } from '../io';
import { ConnectionState } from '../state';
import { autoReconnect } from '../reconnect';

let selection: TabSelectionContext | null;
const connects: string[] = [];
const io: ConnectionIO = {
  getSelectedUser: async (): Promise<TabSelectionContext | null> => selection,
  connect: async (p: { serverAddress: string }): Promise<void> => { connects.push(p.serverAddress); },
  waitForHealthy: async (): Promise<void> => undefined,
  updateConnectionService: (): void => undefined,
  broadcastConnectionStatus: (): void => undefined,
  emitEvent: (): void => undefined,
  loadSessionsFromLocalDB: async () => ({ sessions: [] }),
  storeSessionsToLocalDB: async (): Promise<void> => undefined,
} as unknown as ConnectionIO;

const record = (serverAddress: string): StoredSession => ({ username: 'alice', serverAddress, password: 'p' }) as unknown as StoredSession;

function leaderWith(session: StoredSession): ConnectionState {
  const state: ConnectionState = new ConnectionState((): boolean => true);
  state.setStoredSessions({ sessions: [session] });
  return state;
}

beforeEach(() => { connects.length = 0; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('auto-reconnect and a record without a server', () => {
  it('a selection without a server reconnects nothing and schedules nothing', async () => {
    selection = { selectedUsername: 'alice', selectedServerAddress: '' } as TabSelectionContext;
    await autoReconnect([], leaderWith(record('')), io, async () => [], async () => undefined);
    expect(connects).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a selection with a server does not match the serverless record', async () => {
    selection = { selectedUsername: 'alice', selectedServerAddress: 'bench.work.avarok.net' } as TabSelectionContext;
    await autoReconnect([], leaderWith(record('')), io, async () => [], async () => undefined);
    expect(connects).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the same record with a server does reconnect, naming it (the test can see a Connect)', async () => {
    selection = { selectedUsername: 'alice', selectedServerAddress: 'bench.work.avarok.net' } as TabSelectionContext;
    await autoReconnect([], leaderWith(record('bench.work.avarok.net')), io, async () => [], async () => undefined);
    expect(connects).toEqual(['bench.work.avarok.net']);
  });
});
