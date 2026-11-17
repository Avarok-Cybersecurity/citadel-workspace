/**
 * A sign-out record that could not be READ must not be written back.
 *
 * `persistUserDisconnectedSessions` writes the whole set of sessions the user
 * signed out of. `loadAutoConnectSettings` returns an EMPTY set with
 * `initialized: false` when the read fails — and the three writers never
 * consulted that flag. Only `getEnabled` did.
 *
 * So: boot, the LocalDB read times out, the set is empty. The user signs out
 * of A. `{A@srv}` is written over the stored `{B@srv, C@srv}`. Next boot, B
 * and C are auto-reconnected — sessions the user deliberately signed out of.
 * The module's own header calls that outcome "neither visible nor
 * recoverable", which is exactly right: nothing tells the user, and signing
 * out again only re-records the one session.
 *
 * Seventh site of one mechanism: a whole-collection write from a collection
 * that was never successfully read.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const stored: Map<string, number[]> = new Map<string, number[]>();
let getBehaviour: 'absent' | 'timeout' | 'stored' = 'absent';

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: async (_cid: bigint, key: string): Promise<{ value: number[] } | null> => {
      if (getBehaviour === 'timeout') throw new Error('LocalDB request timed out after 5000ms');
      const value: number[] | undefined = stored.get(key);
      if (value === undefined) throw new Error(`Key not found: ${key}`);
      return { value };
    },
    sendLocalDBSet: async (_cid: bigint, key: string, value: number[]): Promise<void> => {
      stored.set(key, value);
    },
  },
}));

import {
  loadUserDisconnectedSessions,
  persistUserDisconnectedSessions,
  resetDisconnectedReadTracking,
} from '../persistence';

// Imported, never spelled out. The first draft of this file hardcoded a
// plausible 'auto_connect_user_disconnected'; the real key is
// 'user_disconnected_sessions', so every assertion would have read a key
// nothing writes — the same way a live-document test passed while checking a
// key that did not exist.
import { USER_DISCONNECTED_KEY as KEY } from '../types';

function encode(keys: string[]): number[] {
  return Array.from(new TextEncoder().encode(JSON.stringify(keys)));
}

function onDisk(): string[] | null {
  const raw: number[] | undefined = stored.get(KEY);
  return raw ? (JSON.parse(new TextDecoder().decode(new Uint8Array(raw))) as string[]) : null;
}

describe('the user-disconnected set', () => {
  beforeEach(() => {
    stored.clear();
    getBehaviour = 'absent';
    resetDisconnectedReadTracking();
  });

  it('is not erased when the read failed', async () => {
    stored.set(KEY, encode(['bob@srv', 'carol@srv']));
    getBehaviour = 'timeout';

    await expect(loadUserDisconnectedSessions()).rejects.toThrow(/timed out/);

    // The sign-out that follows, with an in-memory set that never loaded.
    await persistUserDisconnectedSessions(new Set(['alice@srv']));

    expect(onDisk(), "bob and carol must still be signed out").toEqual(['bob@srv', 'carol@srv']);
  });

  it('is not written before any read has happened', async () => {
    stored.set(KEY, encode(['bob@srv']));
    await persistUserDisconnectedSessions(new Set(['alice@srv']));
    expect(onDisk()).toEqual(['bob@srv']);
  });

  it('IS written when nothing was ever stored', async () => {
    // The discrimination. A first sign-out has to be recordable, or the guard
    // is safe and useless.
    expect(await loadUserDisconnectedSessions()).toEqual(new Set());
    await persistUserDisconnectedSessions(new Set(['alice@srv']));
    expect(onDisk()).toEqual(['alice@srv']);
  });

  it('IS written after a read that returned the set', async () => {
    stored.set(KEY, encode(['bob@srv']));
    getBehaviour = 'stored';

    expect(await loadUserDisconnectedSessions()).toEqual(new Set(['bob@srv']));
    await persistUserDisconnectedSessions(new Set(['bob@srv', 'alice@srv']));

    expect(onDisk()).toEqual(['bob@srv', 'alice@srv']);
  });
});
