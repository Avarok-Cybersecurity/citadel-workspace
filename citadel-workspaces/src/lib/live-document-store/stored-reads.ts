/**
 * Live Document Store - Reads over any LocalDB surface
 *
 * The one place a stored document or the document index is read and decoded. persistence.ts
 * calls these with the app's websocket service; the chat-document migration calls them with
 * the same service through its own port. Both keep the same discipline: an absent key is
 * `null` / `[]`, and a read that FAILED is rethrown, never reported as absence.
 */

import { bytesToString } from '@/lib/utils/encoding-utils';
import { debugLog } from '@/lib/debug-config';
import { isGenuinelyAbsent } from '@/lib/storage/absence';

import { DOCUMENTS_KEY_PREFIX, DOCUMENTS_INDEX_KEY, type StoredDocument } from './types';

/** The device-wide documents live under the agent's cid 0, not under any account. */
export const DEVICE_DOCUMENTS_CID: 0n = 0n;

export interface LocalDbGet {
  sendLocalDBGet(cid: bigint, key: string): Promise<{ value: number[] } | null>;
}

/**
 * Decode a value returned from LocalDB into a string.
 */
export function decodeValue(value: unknown): string {
  if (Array.isArray(value)) {
    return bytesToString(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  throw new Error('Unexpected value type');
}

export function documentKey(docId: string): string {
  return `${DOCUMENTS_KEY_PREFIX}_${docId}`;
}

/** A stored document, `null` when its key is absent; any other failure is rethrown. */
export async function readStoredDocument(db: LocalDbGet, docId: string): Promise<StoredDocument | null> {
  let response: { value: number[] } | null;
  try {
    response = await db.sendLocalDBGet(DEVICE_DOCUMENTS_CID, documentKey(docId));
  } catch (error) {
    if (isGenuinelyAbsent(error)) {
      debugLog('LiveDocumentStore', 'No stored document', docId);
      return null;
    }
    // Rethrown, not reported as absence: `null` is read upstream as "this document does not
    // exist", and adoptDocument would write a fresh empty document over the key.
    throw error;
  }
  if (!response?.value) return null;
  return JSON.parse(decodeValue(response.value)) as StoredDocument;
}

/**
 * The document index, `[]` when its key is absent; any other failure is rethrown. Its result
 * decides what the index is OVERWRITTEN with, so "no index" and "could not read the index"
 * must never be confused.
 */
export async function readDocumentIndex(db: LocalDbGet): Promise<string[]> {
  let response: { value: number[] } | null;
  try {
    response = await db.sendLocalDBGet(DEVICE_DOCUMENTS_CID, DOCUMENTS_INDEX_KEY);
  } catch (error) {
    if (isGenuinelyAbsent(error)) return [];
    throw error;
  }
  if (!response?.value) return [];
  return JSON.parse(decodeValue(response.value)) as string[];
}
