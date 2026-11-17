/**
 * IndexedDB schema versioning.
 *
 * The app persists a small amount of state in the browser and ships as an
 * installable PWA — so a returning user always arrives with a database created
 * by whatever version they last ran. Changing the schema is therefore not a
 * code change, it is a data migration against users we cannot coordinate with.
 *
 * Note what is NOT here. Conversations, peer registrations and session records
 * live in the INTERNAL SERVICE's LocalDB, not in the browser — deliberately,
 * because that history needs the local agent and would otherwise imply it
 * survives on the browser alone. This file's header used to claim all four,
 * and v1 created a store for each: `sessions`, `messages`, `peers` and
 * `instances` were created for every user and, across the whole history of the
 * repository, never written to once. v2 drops them.
 *
 * The previous `upgrade(db)` handler took no version arguments and only ever
 * created missing stores. That is correct exactly once, at version 1. Bumping
 * the version would have run it again, found every store present, done nothing,
 * and left the new code reading old-shaped data — a silent corruption rather
 * than a failure.
 *
 * Migrations here are:
 *   - **Sequential.** Every step from the user's version to the current one runs
 *     in order, so a user returning from v1 to v4 is not a special case.
 *   - **Transactional.** They run inside IndexedDB's own upgrade transaction; if
 *     any step throws, the whole upgrade is rolled back and the old database
 *     survives intact.
 *   - **Forward-only.** There is no downgrade path. A browser will refuse to open
 *     a database whose on-disk version is newer than requested, which is handled
 *     explicitly in getDB rather than left to surface as an opaque failure.
 */

import type { IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import { debugLog, errorLog } from './debug-config';

/**
 * Current schema version. Bump this and add a matching entry to MIGRATIONS in
 * the same commit — the test in storage-migrations.test.ts fails if they drift.
 */
export const DB_VERSION: number = 2;

export const DB_NAME: "citadel-workspace" = 'citadel-workspace';

/** Every object store the current schema expects to exist. */
export const STORE_NAMES: readonly ["keyValue", "tabContext"] = ['keyValue', 'tabContext'] as const;

/**
 * Stores v1 created and nothing ever used. Kept named so v2's migration can
 * remove them and so a future schema does not reintroduce one by accident.
 */
export const RETIRED_STORE_NAMES: readonly ["sessions", "messages", "peers", "instances"] = ['sessions', 'messages', 'peers', 'instances'] as const;

export type StoreName = (typeof STORE_NAMES)[number];

/**
 * A single forward step. `version` is the version this migration produces, so
 * the step numbered N runs when upgrading a database at version N-1.
 *
 * `tx` is the upgrade transaction. Use it for any data rewriting — opening a
 * separate transaction inside an upgrade deadlocks.
 */
export interface Migration<DBTypes = unknown> {
  version: number;
  description: string;
  run: (
    db: IDBPDatabase<DBTypes>,
    tx: IDBPTransaction<DBTypes, StoreNames<DBTypes>[], 'versionchange'>
  ) => void;
}

/**
 * Ordered migration steps.
 *
 * Adding one:
 *   1. Append a step whose `version` is the new DB_VERSION.
 *   2. Bump DB_VERSION above.
 *   3. Never edit or renumber a released step — users have already run it, and
 *      changing it means their database and a fresh one disagree.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Create the initial key-value, session, message, peer, tab and instance stores',
    run: (db: IDBPDatabase<unknown>, _tx: IDBPTransaction<unknown, string[], "versionchange">): void => {
      // The v1 store list, spelled out rather than read from STORE_NAMES. A
      // released migration must keep doing what it did when it was released:
      // reading the current list would mean a user upgrading from v0 creates
      // only today's stores, and then v2 tries to delete stores that were
      // never made. Never edit a released step -- this is what that means in
      // practice.
      for (const name of ['keyValue', 'sessions', 'messages', 'peers', 'tabContext', 'instances']) {
        // Guarded because a database may exist from before migrations were
        // tracked, with some or all stores already present.
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name as never);
        }
      }
    },
  },
  {
    version: 2,
    description: 'Drop the session, message, peer and instance stores, which nothing ever used',
    run: (db: IDBPDatabase<unknown>, _tx: IDBPTransaction<unknown, string[], "versionchange">): void => {
      // Safe to delete rather than migrate: no commit in the history of this
      // repository ever wrote to them, so no user can have data there. They
      // were created on the assumption they would be used and were not, while
      // the schema went on implying the browser held conversations and peer
      // registrations that in fact live in the internal service.
      for (const name of RETIRED_STORE_NAMES) {
        if (db.objectStoreNames.contains(name)) {
          db.deleteObjectStore(name);
        }
      }
    },
  },
];

/**
 * Run every migration needed to get from `oldVersion` to `newVersion`.
 *
 * Called from within `openDB`'s upgrade callback, so it is already inside the
 * version-change transaction.
 */
export function runMigrations<DBTypes>(
  db: IDBPDatabase<DBTypes>,
  oldVersion: number,
  newVersion: number | null,
  tx: IDBPTransaction<DBTypes, StoreNames<DBTypes>[], 'versionchange'>
): void {
  const target: number = newVersion ?? DB_VERSION;
  const pending: Migration<unknown>[] = MIGRATIONS.filter(m => m.version > oldVersion && m.version <= target).sort(
    (a, b) => a.version - b.version
  );

  if (pending.length === 0) {
    debugLog('Storage', `No migrations needed (v${oldVersion} -> v${target})`);
    return;
  }

  debugLog('Storage', `Migrating database v${oldVersion} -> v${target}`, {
    steps: pending.map(m => m.version),
  });

  for (const migration of pending) {
    try {
      migration.run(db as IDBPDatabase<unknown>, tx as never);
      debugLog('Storage', `Applied migration v${migration.version}: ${migration.description}`);
    } catch (error) {
      // Rethrowing aborts the version-change transaction, so IndexedDB rolls the
      // database back to `oldVersion` and the user keeps working on the old
      // schema instead of running new code against half-migrated data.
      errorLog('Storage', `Migration v${migration.version} failed, rolling back upgrade`, error);
      throw error;
    }
  }
}

/**
 * Every store the current schema needs, but which the database does not have.
 *
 * A non-empty result after an upgrade means the migration list is out of step
 * with the schema — worth failing loudly on rather than discovering later as a
 * `NotFoundError` from an unrelated read.
 */
export function missingStores(existing: DOMStringList | string[]): StoreName[] {
  const have: Set<string> = new Set(Array.from(existing as Iterable<string>));
  return STORE_NAMES.filter(name => !have.has(name));
}
