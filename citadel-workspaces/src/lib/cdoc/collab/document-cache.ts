/**
 * The local cache of a document replica, through the device-records seam
 * (lib/document-replica-cache.ts), in the app's one IndexedDB. Values are stored by Structured
 * Clone, so snapshots and updates stay Uint8Arrays and the seq a bigint: no JSON, no revivers.
 *
 * Keyed by account AND node. Several accounts can be signed in to one browser, and one
 * account's copy of a document must never open in another's tab: that one may not be
 * allowed to read it. A value that is there but malformed is an error, never "nothing kept".
 * Removal on sign-out and node deletion: the same seam.
 */
import {
  documentCacheKey, documentDeviceKey, documentEditsKey, documentEditsPrefix, forgetNodeDocuments,
  localRecordGet, localRecordPut, localRecordRemove, localRecordsWithPrefix,
} from '@/lib/document-replica-cache';
import type { InstanceLocks } from './instance-locks';
import type { CachedDocument, DeviceChoices, DocumentCache, HeldEdits } from './ports';

const bytes = (view: ArrayBufferView): Uint8Array => new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
const fields = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? value as Record<string, unknown> : {});

/** A stored value read back; throws when it is not a CachedDocument. */
export function readCached(value: unknown): CachedDocument | null {
  if (value === undefined) return null;
  const v: Record<string, unknown> = fields(value);
  if (typeof v.docVersion !== 'number' || typeof v.seq !== 'bigint' || !ArrayBuffer.isView(v.snapshot)) {
    throw new Error('the cached document is not in the shape this client writes');
  }
  return { docVersion: v.docVersion, seq: v.seq, snapshot: bytes(v.snapshot) };
}

/** Stored held edits read back; throws when they are not a list of updates. */
export function readEdits(value: unknown): readonly Uint8Array[] {
  if (!Array.isArray(value) || !value.every((u: unknown): boolean => ArrayBuffer.isView(u))) {
    throw new Error('the edits kept on this device are not in the shape this client writes');
  }
  return value.map((u: ArrayBufferView): Uint8Array => bytes(u));
}

export function readChoices(value: unknown): DeviceChoices | null {
  if (value === undefined) return null;
  const v: Record<string, unknown> = fields(value);
  if (typeof v.autoSave !== 'boolean') throw new Error('the document\'s choices on this device are not in the shape this client writes');
  return { autoSave: v.autoSave };
}

export function indexedDbDocumentCache(account: bigint, locks: InstanceLocks): DocumentCache {
  return {
    load: async (nodeId: string): Promise<CachedDocument | null> => readCached(await localRecordGet(documentCacheKey(account, nodeId))),
    save: (nodeId: string, document: CachedDocument): Promise<void> =>
      localRecordPut(documentCacheKey(account, nodeId), { docVersion: document.docVersion, seq: document.seq, snapshot: document.snapshot.slice() }),
    forget: (nodeId: string): Promise<void> => forgetNodeDocuments(account, [nodeId]),
    loadEdits: async (nodeId: string): Promise<readonly HeldEdits[]> => {
      const prefix: string = documentEditsPrefix(account, nodeId);
      const open: ReadonlySet<string> = await locks.held();
      return (await localRecordsWithPrefix(prefix)).map(({ key, value }: { readonly key: string; readonly value: unknown }): HeldEdits =>
        ({ instance: key.slice(prefix.length), updates: readEdits(value), open: open.has(key) }));
    },
    saveEdits: (nodeId: string, instance: string, updates: readonly Uint8Array[]): Promise<void> => {
      const key: string = documentEditsKey(account, nodeId, instance);
      return updates.length === 0 ? localRecordRemove(key) : localRecordPut(key, updates.map((u: Uint8Array): Uint8Array => u.slice()));
    },
    // The lock is named for the instance's edits key: one name per instance, per account and node.
    hold: (nodeId: string, instance: string): Promise<() => void> => locks.hold(documentEditsKey(account, nodeId, instance)),
    loadChoices: async (nodeId: string): Promise<DeviceChoices | null> => readChoices(await localRecordGet(documentDeviceKey(account, nodeId))),
    saveChoices: (nodeId: string, choices: DeviceChoices): Promise<void> => localRecordPut(documentDeviceKey(account, nodeId), { autoSave: choices.autoSave }),
  };
}

/** `cache` with every record under `place(nodeId)` instead: a chat document's, beside its node's page. */
export function placedCache(cache: DocumentCache, place: (nodeId: string) => string): DocumentCache {
  return {
    load: (nodeId: string): Promise<CachedDocument | null> => cache.load(place(nodeId)),
    save: (nodeId: string, document: CachedDocument): Promise<void> => cache.save(place(nodeId), document),
    forget: (nodeId: string): Promise<void> => cache.forget(place(nodeId)),
    loadEdits: (nodeId: string): Promise<readonly HeldEdits[]> => cache.loadEdits(place(nodeId)),
    saveEdits: (nodeId: string, instance: string, updates: readonly Uint8Array[]): Promise<void> => cache.saveEdits(place(nodeId), instance, updates),
    hold: (nodeId: string, instance: string): Promise<() => void> => cache.hold(place(nodeId), instance),
    loadChoices: (nodeId: string): Promise<DeviceChoices | null> => cache.loadChoices(place(nodeId)),
    saveChoices: (nodeId: string, choices: DeviceChoices): Promise<void> => cache.saveChoices(place(nodeId), choices),
  };
}
