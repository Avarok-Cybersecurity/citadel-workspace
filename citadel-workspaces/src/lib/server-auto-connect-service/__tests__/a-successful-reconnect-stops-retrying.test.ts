/**
 * A reconnect that succeeded went on retrying.
 *
 * `handleConnectionSuccess` read `username` and `server_addr` off the
 * `ConnectSuccess` message and did all of its work inside `if (username)`.
 * `ConnectSuccess` has neither field. Rust says
 * `pub struct ConnectSuccess { cid, request_id }` and the generated binding
 * agrees: `{ cid: bigint, request_id: string | null }`. The cast at the call
 * site invented them:
 *
 *   connectSuccess as { cid?: bigint; username?: string; server_addr?: string }
 *
 * So `username` was always undefined and the body never ran — not once. The
 * retry for that session was never cancelled, the session was never added to
 * `activeSessionKeys`, and a user-initiated disconnect was never cleared. A
 * session that had just reconnected successfully kept its retry timer, and
 * `ServerAutoConnect` interfering with settled connections is a known cause of
 * P2P flakiness in this tree.
 *
 * The `cid` it DID carry identifies the session: `StoredSession.cid` is
 * recorded at login for exactly this kind of lookup.
 */
import { describe, it, expect } from 'vitest';
import { applyConnectionSuccess, type ConnectionSuccessDeps } from '../connection-success';
import type { StoredSession } from '@/types/session-types';

function session(username: string, cid: bigint): StoredSession {
  return { username, serverAddress: '127.0.0.1:12349', cid } as StoredSession;
}

type Harness = ConnectionSuccessDeps & { cancelled: string[]; activated: string[]; persisted: number };

function deps(sessions: StoredSession[], disconnected: string[] = []): Harness {
  const cancelled: string[] = [];
  const activated: string[] = [];
  const state: { persisted: number } = { persisted: 0 };
  const userDisconnected: Set<string> = new Set<string>(disconnected);
  return {
    sessions,
    cancelRetry: (key: string): void => { cancelled.push(key); },
    markActive: (key: string): void => { activated.push(key); },
    userDisconnected,
    persist: async (): Promise<void> => { state.persisted += 1; },
    cancelled, activated,
    get persisted(): number { return state.persisted; },
  };
}

const ALICE: bigint = 111n;
const BOB: bigint = 222n;

describe('a connection that succeeded', () => {
  it('stops the retry for the session that connected', async () => {
    const d: Harness = deps([session('alice', ALICE), session('bob', BOB)]);
    const key: string | null = await applyConnectionSuccess(d, ALICE);

    expect(key).toBe('alice@127.0.0.1:12349');
    expect(d.cancelled).toEqual(['alice@127.0.0.1:12349']);
    expect(d.activated).toEqual(['alice@127.0.0.1:12349']);
  });

  it('does not touch a different session', async () => {
    // Negative control: keying off the wrong session would cancel somebody
    // else's retry, which is the failure this replaces, not a fix for it.
    const d: Harness = deps([session('alice', ALICE), session('bob', BOB)]);
    await applyConnectionSuccess(d, BOB);

    expect(d.cancelled).toEqual(['bob@127.0.0.1:12349']);
  });

  it('clears a user-initiated disconnect once they are back', async () => {
    const d: Harness = deps([session('alice', ALICE)], ['alice@127.0.0.1:12349']);
    await applyConnectionSuccess(d, ALICE);

    expect(d.userDisconnected.has('alice@127.0.0.1:12349')).toBe(false);
    expect(d.persisted).toBe(1);
  });

  it('does nothing, and persists nothing, for a cid it has no session for', async () => {
    // The success may belong to a session this device never stored. Acting on
    // "the" session without knowing which is what the old code could not do
    // safely either.
    const d: Harness = deps([session('alice', ALICE)]);
    const key: string | null = await applyConnectionSuccess(d, 999n);

    expect(key).toBeNull();
    expect(d.cancelled).toEqual([]);
    expect(d.persisted).toBe(0);
  });
});
