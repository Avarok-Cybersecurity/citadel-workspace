/**
 * IndexedDB schema versioning.
 *
 * The app persists a small amount of state in the browser and ships as an
 * installable PWA, so a returning user arrives with a database created by
 * whatever version they last ran. Conversations, peer registrations and session
 * records live in the agent's LocalDB, not here.
 *
 * There are no migrations. A database from an earlier version is CLEARED on
 * upgrade: every store it has is deleted and the current ones are created
 * empty, so the user signs in fresh (owner, 2026-11-21: alpha, no reverse
 * compatibility). It runs inside IndexedDB's own upgrade transaction, so a
 * failure rolls the whole upgrade back. A database NEWER than this build is
 * refused in getDB (storage-utils.ts), never opened.
 */

import { debugLog } from './debug-config';

/**
 * Current schema version. Bumping it clears every earlier browser's database on
 * its next open. 3: the release on SDK protocol 0.12.4.
 */
export const DB_VERSION: number = 3;

export const DB_NAME: "citadel-workspace" = 'citadel-workspace';

/** Every object store the current schema has. */
export const STORE_NAMES: readonly ["keyValue", "tabContext"] = ['keyValue', 'tabContext'] as const;

export type StoreName = (typeof STORE_NAMES)[number];

/** The part of an upgrading database this needs (idb's IDBPDatabase in the app). */
export interface UpgradingDatabase {
  readonly objectStoreNames: Iterable<string> & { contains(name: string): boolean };
  createObjectStore(name: never): unknown;
  deleteObjectStore(name: never): void;
}

/**
 * Bring a database at `oldVersion` to the current schema. A fresh database
 * (version 0) gets the current stores; an earlier one is cleared first. Called
 * from within `openDB`'s upgrade callback.
 */
export function upgradeSchema(target: UpgradingDatabase, oldVersion: number): void {
  if (oldVersion > 0) {
    const existing: string[] = Array.from(target.objectStoreNames);
    debugLog('Storage', `Clearing a v${oldVersion} database for v${DB_VERSION}`, { stores: existing });
    for (const name of existing) target.deleteObjectStore(name as never);
  }
  for (const name of STORE_NAMES) target.createObjectStore(name as never);
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
