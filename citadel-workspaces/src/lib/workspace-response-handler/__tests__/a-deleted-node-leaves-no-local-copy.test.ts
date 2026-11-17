/**
 * When a node is deleted, the decrypted copies this device keeps of it and of every child
 * deleted with it are removed, for every account here that held one, and no other node's.
 * `storage-utils` is a Map: jsdom has no IndexedDB (as document-cache.test.ts).
 */
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceProtocolResponse } from 'citadel-workspace-client-ts';
import type { ConnectionInfo } from '../workspace-handlers';

const store: Map<string, unknown> = vi.hoisted((): Map<string, unknown> => new Map<string, unknown>());
vi.mock('@/lib/storage-utils', () => ({
  dbDelete: (_s: string, k: string): Promise<void> => { store.delete(k); return Promise.resolve(); },
  // IDBKeyRange.bound(prefix, prefix + '\uffff'), as document-cache.test.ts.
  dbKeysWithPrefix: (_s: string, prefix: string): Promise<string[]> =>
    Promise.resolve([...store.keys()].filter((k: string): boolean => k >= prefix && k <= `${prefix}\uffff`)),
}));

const { handleNodeVariants } = await import('../node-handlers');
const { documentCacheKey } = await import('@/lib/document-replica-cache');

const connection: ConnectionInfo = { request_id: 'req-1', cid: 0 };

describe('NodeDeleted', () => {
  it('removes the local copies of the node and its deleted children, and only those', async () => {
    for (const node of ['plan', 'plan-child', 'other', 'other:plan']) store.set(documentCacheKey(5n, node), { seq: 1n });
    store.set(documentCacheKey(6n, 'plan'), { seq: 1n });
    const deleted: WorkspaceProtocolResponse = { NodeDeleted: { node_id: 'plan', children_deleted: ['plan-child'] } } as WorkspaceProtocolResponse;
    expect(handleNodeVariants(deleted, connection)).toBe(true);
    await vi.waitFor((): void => expect(store.has(documentCacheKey(6n, 'plan'))).toBe(false));
    expect([...store.keys()].sort()).toEqual([documentCacheKey(5n, 'other'), documentCacheKey(5n, 'other:plan')].sort());
  });
});
