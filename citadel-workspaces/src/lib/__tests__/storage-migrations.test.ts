import { describe, it, expect, vi  } from 'vitest';
import type { Migration } from '@/lib/storage-migrations';
import {
  DB_VERSION,
  MIGRATIONS,
  STORE_NAMES,
  RETIRED_STORE_NAMES,
  runMigrations,
  missingStores,
} from '../storage-migrations';

/**
 * A returning user always arrives with a database created by whatever version of
 * the app they last ran, and we cannot coordinate with them. These pin the rules
 * that make that safe.
 */

function fakeDb(existingStores: string[] = []): {
  objectStoreNames: { contains: (n: string) => boolean; [Symbol.iterator]: () => SetIterator<string> };
  createObjectStore: ReturnType<typeof vi.fn>;
  deleteObjectStore: ReturnType<typeof vi.fn>;
  _stores: Set<string>;
} {
  const stores: Set<string> = new Set(existingStores);
  return {
    objectStoreNames: {
      contains: (n: string): boolean => stores.has(n),
      [Symbol.iterator]: (): SetIterator<string> => stores[Symbol.iterator](),
    },
    createObjectStore: vi.fn((n: string) => stores.add(n)),
    deleteObjectStore: vi.fn((n: string) => stores.delete(n)),
    _stores: stores,
  };
}

describe('migration list integrity', () => {
  it('has a migration for every version up to DB_VERSION', () => {
    // The failure this catches: bumping DB_VERSION without adding a step, which
    // opens the database at a new version, runs nothing, and leaves new code
    // reading old-shaped data.
    const versions: number[] = MIGRATIONS.map(m => m.version);
    expect(Math.max(...versions)).toBe(DB_VERSION);
    for (let v: number = 1; v <= DB_VERSION; v++) {
      expect(versions).toContain(v);
    }
  });

  it('numbers migrations uniquely and consecutively from 1', () => {
    const versions: number[] = MIGRATIONS.map(m => m.version).sort((a, b) => a - b);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions).toEqual(versions.map((_, i) => i + 1));
  });

  it('describes every migration, so an upgrade log is readable', () => {
    for (const m of MIGRATIONS) expect(m.description.trim().length).toBeGreaterThan(0);
  });
});

describe('runMigrations', () => {
  it('leaves a fresh database holding exactly the current stores', () => {
    // Every step from 0, so this covers v1 creating six and v2 removing the
    // four nothing ever used -- the property that matters is the END state
    // matching the schema, not what any one step did.
    const db: ReturnType<typeof fakeDb> = fakeDb();
    runMigrations(db as never, 0, DB_VERSION, {} as never);
    expect([...db._stores].sort()).toEqual([...STORE_NAMES].sort());
  });

  it('removes the retired stores from a v1 database', () => {
    const db: ReturnType<typeof fakeDb> = fakeDb([...STORE_NAMES, ...RETIRED_STORE_NAMES]);
    runMigrations(db as never, 1, DB_VERSION, {} as never);
    for (const name of RETIRED_STORE_NAMES) {
      expect(db._stores.has(name)).toBe(false);
    }
    for (const name of STORE_NAMES) {
      expect(db._stores.has(name)).toBe(true);
    }
  });

  it('does nothing when the database is already current', () => {
    const db: ReturnType<typeof fakeDb> = fakeDb([...STORE_NAMES]);
    runMigrations(db as never, DB_VERSION, DB_VERSION, {} as never);
    expect(db.createObjectStore).not.toHaveBeenCalled();
  });

  it('runs every intervening step, so an old install is not a special case', () => {
    // A user returning from v1 to v4 must get steps 2, 3 and 4 — not just 4.
    const ran: number[] = [];
    const steps: { version: number; description: string; run: () => void; }[] = [2, 3, 4].map(version => ({
      version,
      description: `step ${version}`,
      run: (): void => { ran.push(version); },
    }));
    const original: Migration<unknown>[] = MIGRATIONS.slice();
    MIGRATIONS.push(...steps);
    try {
      runMigrations(fakeDb([...STORE_NAMES]) as never, 1, 4, {} as never);
      expect(ran).toEqual([2, 3, 4]);
    } finally {
      MIGRATIONS.length = 0;
      MIGRATIONS.push(...original);
    }
  });

  it('applies steps in order even if declared out of order', () => {
    const ran: number[] = [];
    const original: Migration<unknown>[] = MIGRATIONS.slice();
    MIGRATIONS.push(
      { version: 3, description: 'c', run: () => { ran.push(3); } },
      { version: 2, description: 'b', run: () => { ran.push(2); } },
    );
    try {
      runMigrations(fakeDb([...STORE_NAMES]) as never, 1, 3, {} as never);
      expect(ran).toEqual([2, 3]);
    } finally {
      MIGRATIONS.length = 0;
      MIGRATIONS.push(...original);
    }
  });

  it('rethrows a failing step so IndexedDB rolls the whole upgrade back', () => {
    // The alternative — swallowing it — leaves new code running against a
    // half-migrated database, which is worse than not upgrading at all.
    const original: Migration<unknown>[] = MIGRATIONS.slice();
    MIGRATIONS.push({
      version: 2,
      description: 'explodes',
      run: () => { throw new Error('disk full'); },
    });
    try {
      expect(() => runMigrations(fakeDb([...STORE_NAMES]) as never, 1, 2, {} as never))
        .toThrow('disk full');
    } finally {
      MIGRATIONS.length = 0;
      MIGRATIONS.push(...original);
    }
  });

  it('does not run steps beyond the requested target version', () => {
    const ran: number[] = [];
    const original: Migration<unknown>[] = MIGRATIONS.slice();
    MIGRATIONS.push(
      { version: 2, description: 'b', run: () => { ran.push(2); } },
      { version: 3, description: 'c', run: () => { ran.push(3); } },
    );
    try {
      runMigrations(fakeDb([...STORE_NAMES]) as never, 1, 2, {} as never);
      expect(ran).toEqual([2]);
    } finally {
      MIGRATIONS.length = 0;
      MIGRATIONS.push(...original);
    }
  });
});

describe('missingStores', () => {
  it('reports nothing when the schema is satisfied', () => {
    expect(missingStores([...STORE_NAMES])).toEqual([]);
  });

  it('names the stores a migration forgot to create', () => {
    expect(missingStores(['keyValue'])).toContain('tabContext');
    expect(missingStores([])).toEqual([...STORE_NAMES]);
  });

  it('does not ask for a retired store back', () => {
    // missingStores drives a hard failure inside the upgrade transaction. If it
    // still named the v1 stores, v2 would delete them and then abort the very
    // upgrade that deleted them, on every open, forever.
    expect(missingStores([...STORE_NAMES])).toEqual([]);
  });
});
