import { dbGet, dbPut } from '@/lib/storage-utils';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import type { GroupConversation } from '@/types/group';
import { debugLog } from '@/lib/debug-config';

/**
 * Groups that survive a reload.
 *
 * The store was memory-only, and nothing rebuilt it: `refresh()` has no caller,
 * and `GroupListGroupsSuccess` is handled nowhere. So every reload emptied the
 * sidebar, and opening a bookmarked `/groups/:id` reported **"This group may
 * have been deleted"** and bounced to the workspace — for a group that still
 * existed, with its history still on the server, now unreachable because there
 * was no way back in.
 *
 * IndexedDB rather than localStorage, deliberately. The previous localStorage
 * attempt never once worked: member CIDs are `bigint`, `JSON.stringify` throws
 * on bigint, and the failure was swallowed by a try/catch — so every instance
 * always started from nothing. Structured clone stores bigint natively, which
 * is exactly why this project's CID rules say browser persistence belongs here.
 *
 * Keyed per account: two accounts in one browser must not inherit each other's
 * group list, the same way conversations are now scoped.
 */
const STORE: "keyValue" = 'keyValue';

function key(): string | null {
  const own: bigint | null = instanceManager.cid;
  // Without a session there is no account to file these under, and guessing is
  // how one account inherits another's groups.
  return own ? `groups:${own.toString()}` : null;
}

/**
 * Whether this account's group key has actually been read.
 *
 * `persistGroups` writes the WHOLE list. That is sound only when the list in
 * memory came from the key; if the read FAILED, the list is empty for a reason
 * unrelated to what is stored, and writing it erases every group.
 *
 * The old comment here justified returning `[]` on failure with "the live
 * event stream still repopulates the list". It does not. `reconcileGroups` is
 * deliberately remove-only -- "a group the server lists but the client does
 * not hold is NOT added here", because the wire carries only a group key -- and
 * invites are not replayed. Nothing repopulates.
 *
 * `resetGroupsForSession` already refuses to persist for exactly this reason,
 * in a comment forty lines away: "writing an empty list under the NEW
 * account's key would destroy the very groups the restore is about to read".
 * The guard existed on one of the two paths.
 *
 * Keyed by account, not a single flag: the key is per-CID, and having read
 * alice's groups says nothing about whether bob's were read.
 */
const readKeys: Set<string> = new Set<string>();

/** For tests: forget what has been read, so a scenario starts cold. */
export function resetGroupReadTracking(): void {
  readKeys.clear();
}

export async function loadPersistedGroups(): Promise<GroupConversation[]> {
  const k: string | null = key();
  if (!k) return [];
  try {
    const stored: GroupConversation[] | undefined = await dbGet<GroupConversation[]>(STORE, k);
    // `undefined` is IndexedDB's answer for a key that is not there, which is
    // a complete picture of nothing -- a first-run account must be able to
    // write its first group. Only a THROW means the read did not happen.
    readKeys.add(k);
    return Array.isArray(stored) ? stored : [];
  } catch (error) {
    // Reading stays best-effort: a storage hiccup must not block the app from
    // starting, and the sidebar can render what it has. WRITING does not --
    // see `readKeys`.
    debugLog('GroupPersistence', 'Could not read stored groups', error);
    return [];
  }
}

export async function persistGroups(groups: GroupConversation[]): Promise<void> {
  const k: string | null = key();
  if (!k) return;
  if (!readKeys.has(k)) {
    // Refusing is the point. One invite arriving after a failed read would
    // otherwise write a list of exactly that group over every group this
    // account had -- and the next reload shows one group, with bookmarked
    // links reporting "This group may have been deleted", which is the defect
    // this module's header says it exists to prevent.
    debugLog('GroupPersistence', 'Refusing to write groups: the key was never read');
    return;
  }
  try {
    await dbPut(STORE, k, groups);
  } catch (error) {
    debugLog('GroupPersistence', 'Could not persist groups', error);
  }
}
