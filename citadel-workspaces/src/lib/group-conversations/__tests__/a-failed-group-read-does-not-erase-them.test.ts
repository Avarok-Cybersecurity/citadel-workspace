/**
 * A group list that could not be READ must not be written back.
 *
 * `persistGroups` writes the WHOLE list for this account's key, and
 * `updateGroups` calls it on every change. Sound only when the list in memory
 * came from the key. If the read FAILED — another tab holding a `versionchange`
 * open, private mode, `getDB()` rejecting on a version mismatch, all states
 * this app has a recovery screen for — the list is empty for a reason unrelated
 * to what is stored, and one arriving invite writes a list of exactly that
 * group over every group the account had.
 *
 * The old code returned `[]` on a failed read with a comment that said "A read
 * failure is not 'no groups' — but ... the live event stream still repopulates
 * the list." It does not. `reconcileGroups` is deliberately remove-only ("a
 * group the server lists but the client does not hold is NOT added here",
 * because the wire carries only a group key), and invites are not replayed.
 * Nothing repopulates. The next reload shows one group and a bookmarked
 * `/groups/:id` reports "This group may have been deleted" — which is the
 * defect `restorePersistedGroups` was written to prevent.
 *
 * `resetGroupsForSession` already refuses to persist for exactly this reason,
 * forty lines away, in a comment that spells it out. The guard existed on one
 * of the two paths.
 *
 * This is the fifth site of one mechanism. The other four are LocalDB; this one
 * is IndexedDB, which is why `every-localdb-reader-classifies-absence` cannot
 * see it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store: Map<string, unknown> = new Map<string, unknown>();
const cidRef: { current: bigint | null } = { current: null as bigint | null };
let readFails: boolean = false;

vi.mock('@/lib/storage-utils', () => ({
  dbGet: vi.fn(async (_s: string, k: string) => {
    if (readFails) throw new Error('IndexedDB is blocked by another connection');
    return store.get(k);
  }),
  dbPut: vi.fn(async (_s: string, k: string, v: unknown) => { store.set(k, v); }),
}));
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { get cid(): bigint | null { return cidRef.current; } }) };
});

import {
  loadPersistedGroups,
  persistGroups,
  resetGroupReadTracking,
} from '../group-persistence';
import type { GroupConversation } from '@/types/group-entities';

const group = (id: string): GroupConversation =>
  ({ id, name: id, members: [] }) as unknown as GroupConversation;

const KEY: string = 'groups:111';

function storedIds(): string[] | null {
  const v: unknown = store.get(KEY);
  return Array.isArray(v) ? (v as GroupConversation[]).map((g) => g.id) : null;
}

describe('the persisted group list', () => {
  beforeEach(() => {
    store.clear();
    readFails = false;
    cidRef.current = 111n;
    resetGroupReadTracking();
  });

  it('is not erased when the read failed', async () => {
    store.set(KEY, [group('a'), group('b'), group('c')]);

    readFails = true;
    expect(await loadPersistedGroups(), 'the app still starts').toEqual([]);

    // One invite arrives. Under the old code this wrote [invite] over a, b, c.
    await persistGroups([group('invite')]);

    expect(storedIds(), 'all three groups must survive').toEqual(['a', 'b', 'c']);
  });

  it('is not written before any read has happened', async () => {
    store.set(KEY, [group('a')]);
    await persistGroups([group('invite')]);
    expect(storedIds()).toEqual(['a']);
  });

  it('IS written when the account genuinely has nothing stored', async () => {
    // The discrimination. IndexedDB answers a missing key with `undefined`,
    // which is a complete picture of nothing — a first-run account must be
    // able to save its first group. A guard that blocked this too would be
    // safe and useless.
    expect(await loadPersistedGroups()).toEqual([]);
    await persistGroups([group('first')]);
    expect(storedIds()).toEqual(['first']);
  });

  it('IS written after a read that returned the list', async () => {
    store.set(KEY, [group('a')]);
    expect((await loadPersistedGroups()).map((g) => g.id)).toEqual(['a']);
    await persistGroups([group('a'), group('b')]);
    expect(storedIds()).toEqual(['a', 'b']);
  });

  it('tracks per account, so reading one does not license writing another', async () => {
    // The key is per-CID. Having read alice's groups says nothing about
    // whether bob's were read, and a single boolean would have let alice's
    // successful read authorise erasing bob's list.
    store.set('groups:222', [group('bobs')]);
    expect(await loadPersistedGroups()).toEqual([]); // reads groups:111

    cidRef.current = 222n;
    await persistGroups([group('invite')]);

    expect(
      (store.get('groups:222') as GroupConversation[]).map((g) => g.id),
      "bob's list must be untouched",
    ).toEqual(['bobs']);
  });
});
