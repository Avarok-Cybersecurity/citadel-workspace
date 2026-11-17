/**
 * Storage utilities using IndexedDB for native BigInt support.
 *
 * IndexedDB uses the Structured Clone algorithm which handles BigInt natively.
 * No JSON.stringify/parse, no revivers/replacers - data is stored as-is.
 */

import { openDB, IDBPDatabase, DBSchema , type IDBPTransaction } from 'idb';
import { errorLog, warnLog } from './debug-config';
import { DB_NAME, DB_VERSION, runMigrations, missingStores , type StoreName } from './storage-migrations';

// ============================================================================
// Database Schema
// ============================================================================

/**
 * Schema for the Citadel IndexedDB database.
 *
 * All stores use string keys and support any value type (Structured Clone
 * handles BigInt). There are two, and both are used. v1 declared six: the
 * `sessions`, `messages`, `peers` and `instances` stores were created for every
 * user and never written to by any commit in the history of this repository,
 * while asserting to anyone reading the schema that the browser held
 * conversations and peer registrations. Those live in the internal service's
 * LocalDB. See storage-migrations.ts.
 */
interface CitadelDBSchema extends DBSchema {
  /** Key-value store for general data (replaces localStorage) */
  keyValue: {
    key: string;
    value: unknown;
  };
  /** Tab context data store (replaces sessionStorage) */
  tabContext: {
    key: string;
    value: unknown;
  };
}

let dbPromise: Promise<IDBPDatabase<CitadelDBSchema>> | null = null;

/**
 * Get or create the IndexedDB database instance.
 * Uses a singleton pattern for efficiency.
 */
/**
 * How long to wait after being told we are blocked before giving up.
 *
 * Generous: a cooperating tab closes its handle in `blocking` within a tick,
 * so reaching this means the holder is a build that predates that handler, or
 * a frozen tab. Either way it will not resolve on its own.
 */
const BLOCKED_GIVE_UP_MS: number = 10_000;

export function getDB(): Promise<IDBPDatabase<CitadelDBSchema>> {
  if (!dbPromise) {
    let rejectBlocked: ((reason: Error) => void) | null = null;
    // Rejects only if `blocked` actually fired, so a slow-but-progressing
    // upgrade is never killed by a timer.
    const blockedGuard: Promise<never> = new Promise<never>((_, reject): void => {
      rejectBlocked = reject;
    });

    const opening: Promise<IDBPDatabase<CitadelDBSchema>> = openDB<CitadelDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db: IDBPDatabase<CitadelDBSchema>, oldVersion: number, newVersion: number | null, tx: IDBPTransaction<CitadelDBSchema, ("keyValue" | "tabContext")[], "versionchange">): void {
        runMigrations(db, oldVersion, newVersion, tx);

        const missing: ("keyValue" | "tabContext")[] = missingStores(db.objectStoreNames);
        if (missing.length > 0) {
          // The migration list has drifted from the schema. Failing here aborts
          // the upgrade transaction and keeps the old database, which is far
          // easier to diagnose than a NotFoundError from an unrelated read later.
          throw new Error(
            `Schema v${newVersion ?? DB_VERSION} is missing object stores after migration: ${missing.join(', ')}`
          );
        }
      },

      /**
       * Another tab is still holding the previous version open, so this upgrade
       * cannot start. Without this the open() call simply never settles and the
       * app hangs with no explanation — and this app is explicitly multi-tab, so
       * it is the normal case during an update, not an edge case.
       */
      blocked(currentVersion: number, blockedVersion: number | null): void {
        const detail: string =
          `Database upgrade to v${blockedVersion} is blocked by another tab still on v${currentVersion}. ` +
          'Close other Citadel tabs to finish updating.';
        warnLog('Storage', detail);
        // Warning alone does NOT settle the open, which is what the comment
        // above always claimed it did. An unsettled open means every awaiting
        // caller hangs — including the sign-out flow, which puts a
        // full-viewport blocking modal up BEFORE its first read, leaving the
        // whole app unusable until a reload. Give up after a grace period so
        // callers get an error they can show instead of a pending promise.
        setTimeout(() => {
          rejectBlocked?.(new Error(detail));
        }, BLOCKED_GIVE_UP_MS);
      },

      /**
       * THIS tab is the one holding an old version open while another tab tries
       * to upgrade. Closing our connection lets that upgrade proceed; the next
       * database call transparently reopens at the new version.
       */
      blocking(currentVersion: number, blockedVersion: number | null): void {
        warnLog(
          'Storage',
          `Closing our v${currentVersion} connection so another tab can upgrade to v${blockedVersion}`
        );
        void dbPromise?.then(db => db.close());
        dbPromise = null;
      },

      /**
       * The browser closed the connection unexpectedly (storage eviction, or the
       * user cleared site data). Dropping the cached promise means the next call
       * reopens rather than reusing a dead handle forever.
       */
      terminated() {
        errorLog('Storage', 'Database connection terminated unexpectedly; will reopen on next use');
        dbPromise = null;
      },
    }).catch(error => {
      // A VersionError means the on-disk database is NEWER than this build asks
      // for — the user ran a newer version, then loaded an older one (a stale
      // cached bundle, or a rollback). IndexedDB has no downgrade, so say that
      // plainly instead of surfacing an opaque DOMException.
      dbPromise = null;
      if (error instanceof DOMException && error.name === 'VersionError') {
        errorLog(
          'Storage',
          `Local database is newer than this version of Citadel expects (wants v${DB_VERSION}). ` +
            'This usually means an older build was loaded from cache — reload to get the current version.',
          error
        );
      }
      throw error;
    });

    // The guard only ever rejects; if the open wins, it wins normally.
    dbPromise = Promise.race([opening, blockedGuard]).catch((error: unknown) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

// ============================================================================
// Generic IndexedDB Operations
// ============================================================================

// Imported, not spelled out again. This was a hand-written copy of the list in
// storage-migrations.ts -- a second source of truth for which stores exist, and
// the reason four of them could sit unused without anything noticing: every
// place that knew the names knew them independently.

/**
 * Put a value into an IndexedDB store.
 * BigInt values are preserved via Structured Clone.
 */
export async function dbPut<S extends StoreName>(store: S, key: string, value: unknown): Promise<void> {
  const db: IDBPDatabase<CitadelDBSchema> = await getDB();
  await db.put(store, value, key);
}

/**
 * Get a value from an IndexedDB store.
 * BigInt values are automatically restored.
 */
export async function dbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db: IDBPDatabase<CitadelDBSchema> = await getDB();
  const result: unknown = await db.get(store, key);
  return result as T | undefined;
}

/**
 * Delete a value from an IndexedDB store.
 */
export async function dbDelete(store: StoreName, key: string): Promise<void> {
  const db: IDBPDatabase<CitadelDBSchema> = await getDB();
  await db.delete(store, key);
}

/** Puts `value` only if `unchanged(current)`, in one transaction; `unchanged` must be synchronous. */
export async function dbReplaceIf(store: StoreName, key: string, unchanged: (current: unknown) => boolean, value: unknown): Promise<boolean> {
  const tx: IDBPTransaction<CitadelDBSchema, [StoreName], 'readwrite'> = (await getDB()).transaction(store, 'readwrite');
  const replace: boolean = unchanged(await tx.store.get(key));
  if (replace) await tx.store.put(value as never, key);
  await tx.done;
  return replace;
}

/** The keys in a store that start with `prefix`. */
export async function dbKeysWithPrefix(store: StoreName, prefix: string): Promise<string[]> {
  const db: IDBPDatabase<CitadelDBSchema> = await getDB();
  return (await db.getAllKeys(store, IDBKeyRange.bound(prefix, `${prefix}\uffff`))).map(String);
}

// ============================================================================
// JSON Helpers for Logging (BigInt → String for display only)
// ============================================================================

/**
 * JSON replacer that converts BigInt to string for display/logging.
 * Use this ONLY for logging purposes, not for storage.
 */
function bigIntToString(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * JSON stringify that handles BigInt values for logging/display.
 * Converts BigInt to string representation.
 *
 * NOT for persistence: one-way. A bigint read back with JSON.parse is a
 * string, and `"123" === 123n` is false. Use persistJSON below instead.
 */
export function safeJSONStringify(data: unknown, space?: number): string {
  return JSON.stringify(data, bigIntToString, space);
}

/**
 * JSON for storage, with bigints that survive the round trip. Tagged rather
 * than stringified so the reader can tell a CID from a string that looks like
 * one — the convention revfs/opfs-storage already uses.
 */
export function persistJSON(data: unknown): string {
  return JSON.stringify(data, (_key, value) =>
    typeof value === 'bigint' ? { __bigint__: value.toString() } : value
  );
}

/**
 * Inverse of persistJSON. `legacyBigIntFields` names keys older builds wrote
 * as bare strings: that data has no tag, so the field name is the only signal.
 */
export function parsePersistedJSON<T>(text: string, legacyBigIntFields: readonly string[] = []): T {
  const legacy: Set<string> = new Set(legacyBigIntFields);
  return JSON.parse(text, (key, value) => {
    if (value && typeof value === 'object' && '__bigint__' in value) {
      return BigInt((value as { __bigint__: string }).__bigint__);
    }
    if (legacy.has(key) && typeof value === 'string' && /^\d+$/.test(value)) {
      return BigInt(value);
    }
    return value;
  }) as T;
}
