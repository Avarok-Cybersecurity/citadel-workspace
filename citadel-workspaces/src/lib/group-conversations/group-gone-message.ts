import { wasAnnounced, wasEnded } from './ended-groups';

export interface GoneMessage {
  title: string;
  description: string;
}

/**
 * What to tell someone whose group is not in the list.
 *
 * Two different situations, which a `getGroup` miss cannot distinguish but the
 * session can: a group that ENDED while this page was open announced itself,
 * and `ended-groups` remembers that it did. Saying a group "may have been
 * deleted" about an event we watched arrive a moment earlier is the same
 * evasion as telling someone their file picker result "may have expired" when
 * nothing expires — a hedge offered in the one case where the answer is known.
 *
 * The ended wording still says "or you were removed from it", because that is
 * genuinely not distinguishable: deletion and being kicked arrive as the same
 * `GroupDisconnectNotification` and the mapping collapses them.
 */
export function groupGoneMessage(groupId: string): GoneMessage | null {
  // Removed or ended by someone else: group-removal-notice has just said so, by name.
  // A second toast for the same event was measured live.
  if (wasAnnounced(groupId)) return null;
  return wasEnded(groupId)
    ? {
        title: 'Group ended',
        description: 'This group was deleted, or you were removed from it.',
      }
    : {
        title: 'Group not found',
        description: 'This group may have been deleted.',
      };
}
