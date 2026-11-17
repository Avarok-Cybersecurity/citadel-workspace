/**
 * Booting a tab does not erase the session CIDs other tabs recorded.
 *
 * `initialize()` cleared `cid` on every stored session "to force a fresh
 * connection" -- a leftover from before sessions could be claimed -- and wrote
 * the whole list back to the agent-wide key. Every tab boot therefore wiped the
 * CID of every account this browser holds, including one registered seconds
 * earlier in another tab, and the workspace switcher said "Switch Failed —
 * Session CID not available" for all of them. A wrong CID already fails at
 * claim time; there was nothing to force.
 *
 * Mocked: the ConnectionIO router, the manager's one I/O boundary.
 */
import { describe, it, expect, vi } from 'vitest';
import type { StoredSession, StoredSessions } from '@/types/session-types';

const writes: StoredSessions[] = [];
vi.mock('../io', () => {
  const stored: StoredSessions = {
    sessions: [{ username: 'bob0924', serverAddress: 'work.example.net', fullName: 'Bob Brown', lastConnected: 1, cid: 42n } as StoredSession],
  } as StoredSessions;
  const known: Record<string, unknown> = {
    onEvent: (): (() => void) => (): void => {},
    canSendRequests: (): boolean => false,
    loadSessionsFromLocalDB: async (): Promise<StoredSessions> => structuredClone(stored),
    storeSessionsToLocalDB: async (s: StoredSessions): Promise<void> => { writes.push(structuredClone(s)); },
  };
  // Every other I/O call is a no-op that succeeds: this test is about the stored list.
  const connectionIO: unknown = new Proxy(known, {
    get: (target: Record<string, unknown>, key: string): unknown => target[key] ?? ((): Promise<void> => Promise.resolve()),
  });
  return { ConnectionIO: class {}, connectionIO };
});

import { ConnectionManager } from '../service';

describe('booting a tab', () => {
  it('keeps the CID of every stored account, and writes nothing back', async () => {
    const manager: ConnectionManager = ConnectionManager.getInstance();
    await manager.initialize();
    expect(manager.getStoredSessions().sessions[0].cid).toBe(42n);
    expect(writes, 'boot rewrote the agent-wide session list').toEqual([]);
  });

  it('re-reads the stored list on request, for accounts another tab added', async () => {
    const manager: ConnectionManager = ConnectionManager.getInstance();
    const reread: StoredSessions = await manager.reloadStoredSessions();
    expect(reread.sessions.map((s: StoredSession) => [s.username, s.cid])).toEqual([['bob0924', 42n]]);
  });
});
