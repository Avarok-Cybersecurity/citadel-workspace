/**
 * No credential is kept in the stored session, whatever the caller hands over.
 *
 * "Remember Credentials" used to write the account password -- and, until it
 * was gated, the workspace PSK -- into `citadel_sessions` in plaintext, on the
 * agent's CID-0 store where any local process can read it. Passkey unlock
 * replaced it (src/lib/passkey), so the record is built from an allow-list and
 * a secret that reaches `handleAuthSuccess` anyway, through a cast or a stale
 * caller, must still not be written.
 *
 * The storage layer is injected, so these drive the real function and assert on
 * what it hands the IO router.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleAuthSuccess } from '../session-management';
import type { ConnectionState } from '../state';
import type { ConnectionIO } from '../io';
import type { AuthSuccessParams } from '../types';
import type { StoredSessions, StoredSession } from '@/types/session-types';

// Stand-ins for the plaintext values an old build stored: not secrets, and named so no
// line reads as a credential assignment to a secret scanner.
const LEGACY_PLAINTEXT: string = 'legacy-plaintext-fixture';
const LEGACY_WORKSPACE_KEY: string = 'legacy-workspace-key-fixture';

function setup(): { io: ConnectionIO; state: ConnectionState; written: StoredSessions[]; } {
  const stored: StoredSessions = { sessions: [] };
  const written: StoredSessions[] = [];
  const io: ConnectionIO = {
    // The write reads the shared key first; `null` is "nothing stored yet".
    loadSessionsFromLocalDB: vi.fn(async (): Promise<null> => null),
    storeSessionsToLocalDB: vi.fn((s: StoredSessions) => {
      written.push(structuredClone(s));
      return Promise.resolve();
    }),
    setSelectedUser: vi.fn(() => Promise.resolve()),
    setTabContext: vi.fn(() => Promise.resolve()),
    setWorkspaceConnectionId: vi.fn(),
    updateConnectionService: vi.fn(),
  } as unknown as ConnectionIO;
  const state: ConnectionState = {
    storedSessions: stored,
    setStoredSessions: vi.fn(),
    setCurrentConnectionInfo: vi.fn(),
    updateCurrentConnectionInfo: vi.fn(),
    addOrUpdateSession: vi.fn((session: StoredSessions['sessions'][number]) => {
      const i: number = stored.sessions.findIndex(s => s.username === session.username);
      if (i === -1) stored.sessions.push(session);
      else stored.sessions[i] = session;
    }),
  } as unknown as ConnectionState;
  return { io, state, written };
}

/** A caller that still passes secrets, as the pre-passkey login form did. */
function params(): AuthSuccessParams {
  return {
    username: 'alice',
    fullName: 'Alice',
    serverAddress: '127.0.0.1:12349',
    securitySettings: {} as AuthSuccessParams['securitySettings'],
    cid: 1n,
    ...({ password: LEGACY_PLAINTEXT, serverPassword: LEGACY_WORKSPACE_KEY, storeCredentials: true } as object),
  };
}

describe('handleAuthSuccess credential storage', () => {
  it('writes neither the password nor the PSK, anywhere in the record', async () => {
    const { io, state, written } = setup();
    await handleAuthSuccess(params(), state, io);

    const session: StoredSession | undefined = written.at(-1)?.sessions.find(s => s.username === 'alice');
    expect(session).toBeDefined();
    expect(session!.password).toBeUndefined();
    expect(session!.serverPassword).toBeUndefined();

    // Walked rather than JSON.stringify'd, which throws on the bigint cid.
    const values: unknown[] = [];
    const walk = (v: unknown): void => {
      if (v && typeof v === 'object') Object.values(v).forEach(walk);
      else values.push(v);
    };
    walk(written.at(-1));
    expect(values).not.toContain(LEGACY_PLAINTEXT);
    expect(values).not.toContain(LEGACY_WORKSPACE_KEY);
  });

  it('still records the session itself, so it stays reclaimable', async () => {
    // CIDs are permanent and the navbar claims by CID, not by password.
    const { io, state, written } = setup();
    await handleAuthSuccess(params(), state, io);
    const session: StoredSession | undefined = written.at(-1)?.sessions.find(s => s.username === 'alice');
    expect(session!.username).toBe('alice');
    expect(session!.cid).toBe(1n);
    expect(session!.serverAddress).toBe('127.0.0.1:12349');
  });
});
