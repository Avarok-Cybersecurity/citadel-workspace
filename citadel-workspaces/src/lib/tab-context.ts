/**
 * Tab Context Manager
 * Provides tab-specific storage and identification using IndexedDB.
 *
 * IndexedDB uses Structured Clone which handles BigInt natively.
 * No JSON serialization or revivers needed.
 *
 * All functions are async - callers must await.
 */

import { dbPut, dbGet, dbDelete } from './storage-utils';
import { eventEmitter } from './event-emitter';
import { sessionGet, sessionSet } from './safe-session-storage';

const TAB_ID_KEY: "citadel-tab-id" = 'citadel-tab-id';

function mintTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * The tab id when sessionStorage cannot be used at all.
 *
 * Not a cache: this is the ONLY copy in that case, and it is the right
 * lifetime — sessionStorage lives exactly as long as the tab does, so an
 * in-memory id loses only survival across a reload.
 */
let inMemoryTabId: string | null = null;

/**
 * This tab's identity, which every `tab-*` storage key is scoped by.
 *
 * Guarded, because `sessionStorage` is not always there to be read. Strict
 * privacy settings, enterprise policy and some embedded contexts make the
 * accessor THROW rather than return null — and this function runs during boot.
 *
 * Measured with a throwing `sessionStorage`: the app did not mount, did not
 * reach the error boundary, and rendered an empty body. A blank page with a
 * `SecurityError` in the console is worse than a crash screen, because there is
 * nothing on screen to report.
 *
 * `localStorage` is wrapped everywhere it is touched in this codebase. Its
 * sibling was not.
 */
export function getTabId(): string {
  const stored: string | null = sessionGet(TAB_ID_KEY);
  if (stored) return stored;

  const minted: string = mintTabId();
  if (!sessionSet(TAB_ID_KEY, minted)) {
    if (!inMemoryTabId) inMemoryTabId = mintTabId();
    return inMemoryTabId;
  }
  return minted;
}

/**
 * Give this tab a new identity, because another tab was found using the same one.
 *
 * Browsers COPY sessionStorage on Duplicate Tab, so the twins shared this id —
 * and with it every `tab-<id>-*` key, including the selected session. Switching
 * session in one twin rewrote what the other read next, and the CID self-heal
 * then stamped each instance with whatever the shared tab context said, which
 * is how two instances came to claim one CID in the routing map.
 *
 * `reissueInstanceId` already existed for exactly this reason and re-rolled the
 * INSTANCE id only. The tab id is the one the storage keys use.
 */
export function reissueTabId(): string {
  const replacement: string = mintTabId();
  if (!sessionSet(TAB_ID_KEY, replacement)) {
    // Same reasoning as getTabId: without storage the id lives in memory, and
    // a reissue must still take effect for this tab.
    inMemoryTabId = replacement;
  }
  return replacement;
}

// Storage key prefixes
// There was a symmetric `shared-` family here too — setSharedData,
// getSharedData, removeSharedData and getSharedKey — written alongside the
// tab-scoped trio and never called by anything. Speculative symmetry: the
// tab-scoped half has a real consumer in user-service, the shared half had a
// prefix, three functions and no feature. Cross-tab state in this app travels
// by BroadcastChannel and by the storage event, not through a second IndexedDB
// key space.
const TAB_PREFIX: "tab-" = 'tab-';

export function getTabSpecificKey(key: string): string {
  return `${TAB_PREFIX}${getTabId()}-${key}`;
}


/**
 * Store tab-specific data in IndexedDB.
 * BigInt values are preserved via Structured Clone.
 */
export async function setTabData<T>(key: string, value: T): Promise<void> {
  const storageKey: string = getTabSpecificKey(key);
  await dbPut('tabContext', storageKey, value);
}

/**
 * Retrieve tab-specific data from IndexedDB.
 * BigInt values are automatically restored.
 */
export async function getTabData<T>(key: string): Promise<T | null> {
  const storageKey: string = getTabSpecificKey(key);
  const data: T | undefined = await dbGet<T>('tabContext', storageKey);
  return data ?? null;
}

/**
 * Remove tab-specific data from IndexedDB.
 */
export async function removeTabData(key: string): Promise<void> {
  const storageKey: string = getTabSpecificKey(key);
  await dbDelete('tabContext', storageKey);
}




// Tab context interface for managing selected user
export interface TabUserContext {
  selectedUsername?: string;
  selectedServerAddress?: string;
  selectedCid?: bigint;
}

/**
 * Get the currently selected user for this tab.
 */
export async function getSelectedUser(): Promise<TabUserContext | null> {
  return getTabData<TabUserContext>('selected-user');
}

/**
 * Set the selected user for this tab.
 */
export async function setSelectedUser(user: TabUserContext): Promise<void> {
  await setTabData('selected-user', user);
  // Announced, because several things are waiting to hear it and nothing told
  // them.
  //
  // `resolveCurrentUserId` reads this record, so until it exists every
  // permission fetch bails with "nobody is signed in on this tab".
  // `usePermission` retries a failed fetch four times across about 4.6 seconds
  // and then stops, and it restarts that budget only on reconnection, a CID
  // change, or a role change — none of which happen when a tab simply learns
  // who it is. So a budget spent during start-up, before this was written, was
  // never spent again: the gate stayed refused, and the reason it showed was
  // the FIRST failure, cached, describing a state that had since gone away.
  //
  // CI reported that as the workspace admin's own Edit button, disabled for
  // sixty seconds, explaining itself with a sentence that was no longer true.
  eventEmitter.emit('tab:selected-user-changed', user);
}

/**
 * Clear the selected user for this tab.
 */
export async function clearSelectedUser(): Promise<void> {
  await removeTabData('selected-user');
}
