/**
 * What the user is told when a group passes to a new owner, comes back on this device, or ends
 * under them. Pure: the names arrive as values.
 */
import type { GroupEndReason, GroupStateSource } from '@avarok/citadel-protocol-types';

export interface GroupNotice {
  readonly title: string;
  readonly description: string;
}

const named = (groupName: string | undefined, fallback: string): string => groupName?.trim() || fallback;

export function ownerChangedNotice(groupName: string | undefined, ownerName: string, ownerIsSelf: boolean): GroupNotice {
  const group: string = named(groupName, 'this group');
  return ownerIsSelf
    ? { title: `You now own ${group}`, description: 'Its owner left, and the group passed to you.' }
    : { title: `${ownerName} now owns ${group}`, description: 'Its owner left, and the group passed to them.' };
}

/** Null when there is nothing to say: the group resumed from the state this device kept. */
export function restoredNotice(groupName: string | undefined, source: GroupStateSource): GroupNotice | null {
  const group: string = named(groupName, 'A group');
  switch (source) {
    case 'ThisDevice':
      return null;
    case 'Backup':
      return { title: 'History restored on this device', description: `${group} resumed with what was sent while you were away.` };
    case 'Rejoined':
    case 'Refounded':
      return { title: "Earlier history isn't available on this device", description: `${group} continues from here.` };
  }
}

/** Why a group is gone, when the server said; undefined when it did not. */
export function endedNotice(groupName: string | undefined, reason: GroupEndReason | undefined): GroupNotice {
  const group: string = named(groupName, 'that group');
  switch (reason) {
    case 'ClosedByOwner':
      return { title: `${group} has ended`, description: 'Its owner ended the group.' };
    case 'Removed':
      return { title: `You're no longer in ${group}`, description: 'The owner removed you from it.' };
    case 'HierarchyOwnerGone':
      return { title: `${group} has ended`, description: 'This group ended because its owner left. You can start a new group.' };
    case undefined:
      return { title: `You're no longer in ${group}`, description: 'The owner removed you from it, or ended the group.' };
  }
}
