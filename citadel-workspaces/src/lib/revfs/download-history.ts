/**
 * Files this account pulled out of RE-VFS storage, for the sidebar's FILES list.
 *
 * A pull wrote the file into the agent's data dir and left no record anywhere a
 * person looks: the FILES section lists only completed incoming P2P transfers,
 * so it went on saying "No downloaded files yet" beside a file that had just
 * arrived byte-identical. The user could not tell it worked or find it.
 *
 * Its own store rather than rows in the file-transfer history: a pull is not a
 * transfer (no offer, no accept, no bubble), and that history's writers belong
 * to the transfer lifecycle. The sidebar reads both.
 *
 * Storage is injected (SBIO). Records carry bigint cids, so the default store is
 * IndexedDB, whose structured clone keeps them bigints.
 */
import { eventEmitter } from '../event-emitter';
import { dbGet, dbPut } from '../storage-utils';
import { withSerialLock } from '../serial-queue';

export const REVFS_DOWNLOAD_EVENTS: { readonly RECORDED: 'revfs:download-recorded' } = {
  RECORDED: 'revfs:download-recorded',
} as const;

/** Most recent pulls kept per account; older ones fall off the end. */
export const MAX_DOWNLOAD_RECORDS: number = 100;

export interface RevfsDownloadRecord {
  /** Stable per stored object, so pulling the same file again replaces its row. */
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  /** Where the agent wrote it, on the agent's filesystem. Not a URL. */
  savedTo: string;
  /** The peer holding the bytes, or null for server storage. */
  sourceCid: bigint | null;
  /** Who or what the file came from, as the file manager labelled it. */
  sourceLabel: string;
  downloadedAt: number;
}

export interface DownloadHistoryStorage {
  load: (owner: bigint) => Promise<RevfsDownloadRecord[]>;
  save: (owner: bigint, records: RevfsDownloadRecord[]) => Promise<void>;
}

function storageKey(owner: bigint): string {
  return `revfs-downloads:${owner.toString()}`;
}

export const indexedDbDownloadStorage: DownloadHistoryStorage = {
  load: async (owner: bigint): Promise<RevfsDownloadRecord[]> =>
    (await dbGet<RevfsDownloadRecord[]>('keyValue', storageKey(owner))) ?? [],
  save: (owner: bigint, records: RevfsDownloadRecord[]): Promise<void> =>
    dbPut('keyValue', storageKey(owner), records),
};

/** Newest first, one row per object, bounded. Pure. */
export function withRecord(records: RevfsDownloadRecord[], record: RevfsDownloadRecord): RevfsDownloadRecord[] {
  return [record, ...records.filter((r: RevfsDownloadRecord): boolean => r.id !== record.id)]
    .slice(0, MAX_DOWNLOAD_RECORDS);
}

export class RevfsDownloadHistory {
  private readonly storage: DownloadHistoryStorage;

  constructor(storage: DownloadHistoryStorage) {
    this.storage = storage;
  }

  list(owner: bigint): Promise<RevfsDownloadRecord[]> {
    return this.storage.load(owner);
  }

  /** Read-modify-write, serialised: two pulls finishing together must both land. */
  async record(owner: bigint, record: RevfsDownloadRecord): Promise<void> {
    await withSerialLock(storageKey(owner), async (): Promise<void> => {
      const existing: RevfsDownloadRecord[] = await this.storage.load(owner);
      await this.storage.save(owner, withRecord(existing, record));
    });
    eventEmitter.emit(REVFS_DOWNLOAD_EVENTS.RECORDED, record);
  }
}

export const revfsDownloadHistory: RevfsDownloadHistory = new RevfsDownloadHistory(indexedDbDownloadStorage);
