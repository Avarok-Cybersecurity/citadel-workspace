import { eventEmitter } from '@/lib/event-emitter';

/**
 * Groups this session watched end.
 *
 * When a group is deleted — or you are removed from it, which arrives as the
 * same `GroupDisconnectNotification` — the store drops it, `getGroup` misses,
 * and the open page bounces to the workspace saying the group "may have been
 * deleted". That hedge is wrong in the one case where the client actually
 * knows: the event was received and acted upon a moment earlier.
 *
 * Bounded, because this is a per-session breadcrumb and not a record. Losing
 * the oldest entries degrades the message back to the hedge, which is exactly
 * what it says.
 */
const MAX_REMEMBERED: number = 50;
/** groupId → whether someone else ended it (so group-removal-notice already told the user). */
const ended: Map<string, boolean> = new Map<string, boolean>();

export function bindEndedGroups(): void {
  eventEmitter.on('group:deleted', (data: { groupId: string; byOthers?: boolean }) => {
    ended.set(data.groupId, data.byOthers === true);
    // Insertion order, so the oldest goes first.
    while (ended.size > MAX_REMEMBERED) {
      const oldest: string | undefined = ended.keys().next().value;
      if (oldest === undefined) break;
      ended.delete(oldest);
    }
  });
}

/** Whether this session saw that group end. */
export function wasEnded(groupId: string): boolean {
  return ended.has(groupId);
}

/** Whether someone else ended it, which the removal notice has already announced. */
export function wasAnnounced(groupId: string): boolean {
  return ended.get(groupId) === true;
}

/** Test seam. */
export function forgetEndedGroups(): void {
  ended.clear();
}
