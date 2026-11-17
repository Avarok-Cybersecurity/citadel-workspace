/**
 * The IndexedDB cache keeps a replica's bytes and seq exactly, per account, and calls a
 * malformed value what it is. `storage-utils` is replaced by doubles/memory-storage.ts: jsdom
 * has no IndexedDB and fake-indexeddb is not a dependency.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CachedDocument, DocumentCache, HeldEdits } from '../ports';
import { memoryLocks, type MemoryLocks } from './doubles/memory-device';

const store: Map<string, unknown> = vi.hoisted((): Map<string, unknown> => new Map<string, unknown>());
vi.mock('@/lib/storage-utils', async () => (await import('./doubles/memory-storage')).memoryStorageUtils(store));

const { indexedDbDocumentCache, readCached } = await import('../document-cache');
const { forgetAccountDocuments, forgetDeletedNodes, forgetNodeDocuments, localRecordGet, localRecordPut, workspaceTreeKey } = await import('@/lib/document-replica-cache');

// The Web Locks stand-in (memory-device.ts): jsdom has no lock manager.
const locks: MemoryLocks = memoryLocks();

const DOC: CachedDocument = { docVersion: 2, seq: 9_007_199_254_740_993n, snapshot: Uint8Array.from([7, 0, 255]) };

describe('the IndexedDB document cache', () => {
  it('reads back the bytes, the version and the u64 seq exactly', async () => {
    const cache: DocumentCache = indexedDbDocumentCache(11n, locks);
    await cache.save('n1', DOC);
    const back: CachedDocument | null = await cache.load('n1');
    expect(back).toEqual(DOC);
    expect(back?.snapshot).toBeInstanceOf(Uint8Array);
  });

  it('never hands one account another account\'s copy', async () => {
    await indexedDbDocumentCache(11n, locks).save('n2', DOC);
    expect(await indexedDbDocumentCache(12n, locks).load('n2')).toBeNull();
  });

  it('forgets one node\'s copy, and on sign-out every copy of that account and no other\'s', async () => {
    for (const account of [1n, 12n]) for (const node of ['a', 'b', 'c']) await indexedDbDocumentCache(account, locks).save(node, DOC);
    await indexedDbDocumentCache(1n, locks).forget('a');
    await forgetNodeDocuments(12n, ['b', 'c']);
    expect(await indexedDbDocumentCache(1n, locks).load('a')).toBeNull();
    expect(await indexedDbDocumentCache(1n, locks).load('b')).toEqual(DOC);
    expect(await indexedDbDocumentCache(12n, locks).load('a')).toEqual(DOC);
    await forgetAccountDocuments(1n);
    for (const node of ['a', 'b', 'c']) expect(await indexedDbDocumentCache(1n, locks).load(node)).toBeNull();
    expect(await indexedDbDocumentCache(12n, locks).load('a')).toEqual(DOC);
    expect(await indexedDbDocumentCache(12n, locks).load('b')).toBeNull();
  });

  it('calls a malformed value an error, not an empty cache', () => {
    expect(readCached(undefined)).toBeNull();
    expect(() => readCached({ docVersion: 2, seq: 3, snapshot: [1] })).toThrow('not in the shape');
  });
});

describe('this device\'s edits and choices for a document', () => {
  const EDIT: Uint8Array = Uint8Array.from([1, 2, 3]);

  it('keeps each instance\'s edits apart, in order, and says which instance is still open', async () => {
    const cache: DocumentCache = indexedDbDocumentCache(21n, locks);
    await cache.saveEdits('n', 'open-tab', [EDIT, Uint8Array.from([4])]);
    await cache.saveEdits('n', 'closed-tab', [EDIT]);
    const release: () => void = await cache.hold('n', 'open-tab');
    const held: readonly HeldEdits[] = await cache.loadEdits('n');
    expect(held.map((h: HeldEdits) => [h.instance, h.open, h.updates.map((u: Uint8Array) => [...u])])).toEqual([
      ['closed-tab', false, [[1, 2, 3]]],
      ['open-tab', true, [[1, 2, 3], [4]]],
    ]);
    release();
    expect((await cache.loadEdits('n')).every((h: HeldEdits) => !h.open)).toBe(true);
    await cache.saveEdits('n', 'closed-tab', []);
    expect((await cache.loadEdits('n')).map((h: HeldEdits) => h.instance)).toEqual(['open-tab']);
  });

  it('remembers the AutoSave choice, and calls a malformed one an error', async () => {
    const cache: DocumentCache = indexedDbDocumentCache(22n, locks);
    expect(await cache.loadChoices('n')).toBeNull();
    await cache.saveChoices('n', { autoSave: false });
    expect(await cache.loadChoices('n')).toEqual({ autoSave: false });
    expect(await indexedDbDocumentCache(23n, locks).loadChoices('n')).toBeNull();
    await localRecordPut('cdoc-collab:22:m#device', { autoSave: 'no' });
    await expect(cache.loadChoices('m')).rejects.toThrow('not in the shape');
  });

  it('forgets a node\'s copy, edits and choices together, and no other node\'s, not even one whose id starts the same', async () => {
    const cache: DocumentCache = indexedDbDocumentCache(24n, locks);
    for (const node of ['a', 'ab']) {
      await cache.save(node, DOC);
      await cache.saveEdits(node, 't1', [EDIT]);
      await cache.saveChoices(node, { autoSave: true });
    }
    await cache.forget('a');
    expect([await cache.load('a'), await cache.loadEdits('a'), await cache.loadChoices('a')]).toEqual([null, [], null]);
    expect(await cache.load('ab')).toEqual(DOC);
    expect((await cache.loadEdits('ab')).length).toBe(1);
    expect(await cache.loadChoices('ab')).toEqual({ autoSave: true });
  });

  it('sweeps the workspace tree at sign-out, and never when a node is deleted', async () => {
    await localRecordPut(workspaceTreeKey(25n), { tree: 'kept' });
    await indexedDbDocumentCache(25n, locks).saveEdits('gone', 't1', [EDIT]);
    // Node ids are the server's: one that is no node's must not reach the tree.
    await forgetDeletedNodes(['gone', '', '#tree']);
    await forgetNodeDocuments(25n, ['', '#tree']);
    expect(await localRecordGet(workspaceTreeKey(25n))).toEqual({ tree: 'kept' });
    expect(await indexedDbDocumentCache(25n, locks).loadEdits('gone')).toEqual([]);
    await forgetAccountDocuments(25n);
    expect(await localRecordGet(workspaceTreeKey(25n))).toBeUndefined();
  });

  it('refuses a node id holding the reserved #, so no node can name the tree or another\'s edits', async () => {
    await expect(indexedDbDocumentCache(26n, locks).load('x#tree')).rejects.toThrow('not a node id');
  });
});
