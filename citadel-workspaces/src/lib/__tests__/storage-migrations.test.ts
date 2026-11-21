import { describe, it, expect, vi } from 'vitest';
import { DB_VERSION, STORE_NAMES, upgradeSchema, missingStores, type UpgradingDatabase } from '../storage-migrations';

/**
 * A returning user arrives with a database created by whatever version of the app they last
 * ran. An earlier one is cleared, never migrated: the user signs in fresh.
 */

function fakeDb(existingStores: string[] = []): UpgradingDatabase & { _stores: Set<string>; deleteObjectStore: ReturnType<typeof vi.fn> } {
  const stores: Set<string> = new Set(existingStores);
  return {
    objectStoreNames: {
      contains: (n: string): boolean => stores.has(n),
      [Symbol.iterator]: (): Iterator<string> => Array.from(stores)[Symbol.iterator](),
    },
    createObjectStore: vi.fn((n: string) => stores.add(n)) as unknown as UpgradingDatabase['createObjectStore'],
    deleteObjectStore: vi.fn((n: string) => { stores.delete(n); }),
    _stores: stores,
  };
}

describe('the browser database schema', () => {
  it('is version 3: every database written before this release is cleared on its next open', () => {
    expect(DB_VERSION).toBe(3);
  });

  it('gives a fresh database exactly the current stores', () => {
    const db = fakeDb();
    upgradeSchema(db, 0);
    expect([...db._stores].sort()).toEqual([...STORE_NAMES].sort());
    expect(db.deleteObjectStore).not.toHaveBeenCalled();
  });

  it('clears an earlier database, its data and retired stores included, and starts it empty', () => {
    const db = fakeDb(['keyValue', 'tabContext', 'sessions', 'messages']);
    upgradeSchema(db, 2);
    expect(db.deleteObjectStore).toHaveBeenCalledTimes(4);
    expect([...db._stores].sort()).toEqual([...STORE_NAMES].sort());
  });
});

describe('missingStores', () => {
  it('reports nothing when the schema is satisfied', () => {
    expect(missingStores([...STORE_NAMES])).toEqual([]);
  });

  it('names the stores an upgrade forgot to create', () => {
    expect(missingStores(['keyValue'])).toEqual(['tabContext']);
  });
});
