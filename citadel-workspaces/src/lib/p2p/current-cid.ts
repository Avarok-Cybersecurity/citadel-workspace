/**
 * Which session this tab is acting as.
 *
 * The priority chain existed twice — once here (as `cid-resolver.ts`, whose own
 * header read "Extracted to avoid duplication across service methods") and once
 * in `p2p-registration-service/discovery.ts`, with the same four steps, the
 * same 500 ms timeout under two different constant names, and differing only
 * in debug logging. This is session identity in the multi-tab hot path, which
 * is precisely where the next "fixed in one place" bug would have landed:
 * reorder the chain, or add a fallback, and one of the two would keep the old
 * answer.
 */

import { connectionManager } from '../connection';
import { instanceManager } from '../multi-instance';
import { getSelectedUser } from '../tab-context';
import { CID_LOOKUP_TIMEOUT_MS } from '../p2p-auto-connect-service/constants';
import type { TabUserContext } from '@/lib/tab-context';
import type { CurrentConnectionInfo } from '@/lib/connection/types';
import type { StoredSession } from '@/types/session-types';

/**
 * Get current CID with proper priority for multi-tab support:
 * 1) InstanceManager CID (FIRST - synchronous, set by handleSuccessfulConnection)
 * 2) Tab context selectedCid (IndexedDB - may hang on follower tabs)
 * 3) StoredSession.cid (IndexedDB - may hang on follower tabs)
 * 4) Global connection CID (legacy fallback)
 *
 * CRITICAL: InstanceManager.cid is checked FIRST because:
 * - It's set synchronously in handleSuccessfulConnection (no async delays)
 * - IndexedDB reads can hang indefinitely on follower tabs due to contention
 * - For multi-tab scenarios, instanceManager is the reliable source of truth
 */
export async function getCurrentCid(): Promise<bigint | null> {
  // 1) InstanceManager CID FIRST (bypasses IndexedDB, synchronous)
  const instanceCid: bigint | null = instanceManager.cid;
  if (instanceCid) {
    return instanceCid;
  }

  // 2) Tab context from IndexedDB (with timeout to prevent hangs)
  try {
    const tabSelectionPromise: Promise<TabUserContext | null> = getSelectedUser();
    const timeout: Promise<null> = new Promise<null>((resolve) => setTimeout((): void => resolve(null), CID_LOOKUP_TIMEOUT_MS));
    const tabSelection: TabUserContext | null = await Promise.race([tabSelectionPromise, timeout]);
    if (tabSelection?.selectedCid) {
      return tabSelection.selectedCid;
    }
  } catch {
    // Ignore timeout/errors
  }

  // 3) Tab session from stored sessions (with timeout)
  try {
    const tabSessionPromise: Promise<StoredSession | null> = connectionManager.getTabSelectedSession();
    const timeout: Promise<null> = new Promise<null>((resolve) => setTimeout((): void => resolve(null), CID_LOOKUP_TIMEOUT_MS));
    const tabSession: StoredSession | null = await Promise.race([tabSessionPromise, timeout]);
    if (tabSession?.cid) {
      return tabSession.cid;
    }
  } catch {
    // Ignore timeout/errors
  }

  // 4) Legacy global connection CID
  const connectionInfo: CurrentConnectionInfo | null = connectionManager.getConnectionInfo();
  return connectionInfo?.cid || null;
}
