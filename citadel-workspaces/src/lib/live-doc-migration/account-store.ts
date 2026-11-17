/**
 * Where migrated chat documents are kept: the agent's LocalDB under the LOCAL ACCOUNT's cid
 * (owner decision), never under cid 0 where the device-wide originals live. The originals are
 * only ever read; nothing here can write, overwrite or delete a `live_doc_*` key.
 *
 * A failed read is never "absent": `get` returns null only for a key the agent says is not
 * there, and rethrows everything else, so a timeout cannot look like "not migrated yet".
 */
import { isGenuinelyAbsent } from '@/lib/storage/absence';
import { DEVICE_DOCUMENTS_CID, type LocalDbGet } from '@/lib/live-document-store/stored-reads';

/** The LocalDB operations a migration needs: reads of the originals, and writes of its own keys. */
export interface MigrationLocalDb extends LocalDbGet {
  sendLocalDBSet(cid: bigint, key: string, value: number[]): Promise<void>;
}

export type MigrationKey = `cdoc_migrated_${string}` | `cdoc_snapshot_${string}` | `cdoc_conflicted_${string}` | `cdoc_conflict_${string}`;

export const migrationKeys = (docId: string): {
  readonly marker: MigrationKey; readonly snapshot: MigrationKey; readonly conflictedCopy: MigrationKey; readonly conflict: MigrationKey;
} => ({
  marker: `cdoc_migrated_${docId}`,
  snapshot: `cdoc_snapshot_${docId}`,
  conflictedCopy: `cdoc_conflicted_${docId}`,
  conflict: `cdoc_conflict_${docId}`,
});

export class AccountMigrationStore {
  constructor(private readonly db: MigrationLocalDb, readonly accountCid: bigint) {
    if (accountCid === DEVICE_DOCUMENTS_CID) {
      throw new Error('migrated documents belong to an account; cid 0 holds the device-wide originals and is never written');
    }
  }

  async get(key: MigrationKey): Promise<Uint8Array | null> {
    let response: { value: number[] } | null;
    try {
      response = await this.db.sendLocalDBGet(this.accountCid, key);
    } catch (error) {
      if (isGenuinelyAbsent(error)) return null;
      throw error;
    }
    return response?.value ? Uint8Array.from(response.value) : null;
  }

  /** Only `cdoc_*` keys, by type: an original's `live_doc_*` key cannot be named here. */
  async set(key: MigrationKey, bytes: Uint8Array): Promise<void> {
    await this.db.sendLocalDBSet(this.accountCid, key, Array.from(bytes));
  }
}
