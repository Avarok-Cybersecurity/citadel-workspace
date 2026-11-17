/**
 * The storage-utils stand-in: jsdom has no IndexedDB and fake-indexeddb is not a dependency.
 * A Map that round-trips every value through structuredClone, which is what IndexedDB does to
 * a value, and lists keys in IndexedDB's order. Installed by a test file with
 * `vi.mock('@/lib/storage-utils', async () => (await import('./doubles/memory-storage')).memoryStorageUtils(store))`.
 */
export function memoryStorageUtils(store: Map<string, unknown>): Record<string, unknown> {
  return {
    dbGet: (_s: string, k: string): Promise<unknown> => Promise.resolve(store.has(k) ? structuredClone(store.get(k)) : undefined),
    dbPut: (_s: string, k: string, v: unknown): Promise<void> => { store.set(k, structuredClone(v)); return Promise.resolve(); },
    dbDelete: (_s: string, k: string): Promise<void> => { store.delete(k); return Promise.resolve(); },
    dbReplaceIf: (_s: string, k: string, unchanged: (current: unknown) => boolean, v: unknown): Promise<boolean> => {
      const replace: boolean = unchanged(store.has(k) ? structuredClone(store.get(k)) : undefined);
      if (replace) store.set(k, structuredClone(v));
      return Promise.resolve(replace);
    },
    // IDBKeyRange.bound(prefix, prefix + '￿'): IndexedDB orders string keys by code unit, as `<=` and sort() do.
    dbKeysWithPrefix: (_s: string, prefix: string): Promise<string[]> =>
      Promise.resolve([...store.keys()].filter((k: string): boolean => k >= prefix && k <= `${prefix}￿`).sort()),
  };
}
