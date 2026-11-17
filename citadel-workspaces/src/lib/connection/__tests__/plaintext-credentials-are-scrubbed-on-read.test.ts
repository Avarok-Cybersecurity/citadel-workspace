/**
 * Plaintext passwords stored by builds before passkey unlock are removed the
 * first time the new code reads the session list -- from memory AND from the
 * agent's store -- while the account itself (username, server, CID) survives.
 *
 * The one double is the websocket service, the agent's LocalDB over a
 * WebSocket: the I/O boundary. It is backed by a Map so the test reads the
 * bytes actually written, not a spy's arguments.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SESSION_STORAGE_KEY, type StoredSessions } from '@/types/session-types';
import { persistJSON } from '@/lib/storage-utils';
import { stringToBytes, bytesToString } from '@/lib/utils/encoding-utils';
import { scrubLegacyCredentials } from '../scrub-legacy-credentials';

const disk: Map<string, number[]> = new Map();

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: async (_cid: bigint, key: string): Promise<{ value: number[] }> => {
      const value: number[] | undefined = disk.get(key);
      if (!value) throw new Error('Key not found');
      return { value };
    },
    sendLocalDBSet: async (_cid: bigint, key: string, value: number[]): Promise<void> => { disk.set(key, value); },
  },
}));

const { ConnectionIOWebSocket } = await import('../io-websocket');

// Stand-ins for the plaintext values an old build stored: not secrets, and named so no
// line reads as a credential assignment to a secret scanner.
const LEGACY_PLAINTEXT: string = 'legacy-plaintext-fixture';
const LEGACY_WORKSPACE_KEY: string = 'legacy-workspace-key-fixture';

const legacy: StoredSessions = {
  sessions: [
    {
      username: 'alice', password: LEGACY_PLAINTEXT, serverAddress: '127.0.0.1:12349', serverPassword: LEGACY_WORKSPACE_KEY,
      fullName: 'Alice', lastConnected: 1, cid: 18446744073709551615n, sessionSecuritySettings: {} as never,
    },
    {
      username: 'bob', serverAddress: '127.0.0.1:12349', fullName: 'Bob', lastConnected: 2, cid: 7n,
      sessionSecuritySettings: {} as never,
    },
  ],
};

describe('plaintext credentials from older builds', () => {
  beforeEach(() => {
    disk.clear();
    disk.set(SESSION_STORAGE_KEY, stringToBytes(persistJSON(legacy)));
  });

  it('are gone from what the read returns, and the account is kept', async () => {
    const loaded: StoredSessions | null = await new ConnectionIOWebSocket().loadSessionsFromLocalDB();
    expect(loaded?.sessions.map((s) => [s.username, s.serverAddress, s.cid])).toEqual([
      ['alice', '127.0.0.1:12349', 18446744073709551615n],
      ['bob', '127.0.0.1:12349', 7n],
    ]);
    expect(loaded?.sessions[0]).not.toHaveProperty('password');
    expect(loaded?.sessions[0]).not.toHaveProperty('serverPassword');
  });

  it('are gone from the agent\'s store after the first read', async () => {
    await new ConnectionIOWebSocket().loadSessionsFromLocalDB();
    const onDisk: string = bytesToString(disk.get(SESSION_STORAGE_KEY)!);
    expect(onDisk).not.toContain(LEGACY_PLAINTEXT);
    expect(onDisk).not.toContain(LEGACY_WORKSPACE_KEY);
    expect(onDisk).toContain('alice');
  });

  it('leave an already-clean list untouched and unwritten', () => {
    const clean: StoredSessions = { sessions: [legacy.sessions[1]] };
    expect(scrubLegacyCredentials(clean)).toEqual({ sessions: clean, scrubbed: 0 });
  });
});
