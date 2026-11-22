/**
 * Telling a member that a group has gone from under them.
 *
 * A removed member receives `GroupDisconnectNotification`, the group left the
 * sidebar and nothing was said. The same notification is how every member
 * learns the group ended, and the SDK names why (`GroupEndReason`), so the
 * notice says which: its owner ended it, you were removed, or a command-
 * hierarchy group ended because its owner left -- which offers to start a new
 * group, since nobody carries that one on.
 *
 * Bound BEFORE the store's own `group:deleted` handler, which drops the group:
 * the name has to be read while the group is still there.
 */
import type { GroupEndReason } from '@avarok/citadel-protocol-types';
import { eventEmitter } from '@/lib/event-emitter';
import { toast } from '@/hooks/use-toast';
import { endedNotice } from './group-protocol-notices';

/** What MembersSection listens for to open its create-group dialog. */
export const START_NEW_GROUP_EVENT: string = 'group:start-new-requested';

export function bindGroupRemovalNotice(groupName: (groupId: string) => string | undefined): void {
  eventEmitter.on('group:deleted', (data: { groupId: string; byOthers?: boolean; reason?: GroupEndReason | null }) => {
    // The owner's own delete arrives as GroupEndNotification, without `byOthers`.
    if (data.byOthers !== true) return;
    const reason: GroupEndReason | undefined = data.reason ?? undefined;
    toast({
      ...endedNotice(groupName(data.groupId), reason),
      ...(reason === 'HierarchyOwnerGone'
        ? { action: { label: 'Start a new group', onClick: (): void => eventEmitter.emit(START_NEW_GROUP_EVENT, {}) } }
        : {}),
    });
  });
}
