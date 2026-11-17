/**
 * Telling a member that a group has gone from under them.
 *
 * A removed member receives `GroupDisconnectNotification`, the group left the
 * sidebar and nothing was said. The same notification is how every member
 * learns the owner ended the group: the SDK sends `Disconnected` in both cases,
 * so the copy names both rather than guessing.
 *
 * Bound BEFORE the store's own `group:deleted` handler, which drops the group:
 * the name has to be read while the group is still there.
 */
import { eventEmitter } from '@/lib/event-emitter';
import { toast } from '@/hooks/use-toast';

export interface RemovalNotice { title: string; description: string }

export function removalNotice(groupName: string | undefined): RemovalNotice {
  const name: string | undefined = groupName?.trim() || undefined;
  return {
    title: name ? `You're no longer in ${name}` : "You're no longer in that group",
    description: 'The owner removed you from it, or ended the group.',
  };
}

export function bindGroupRemovalNotice(groupName: (groupId: string) => string | undefined): void {
  eventEmitter.on('group:deleted', (data: { groupId: string; byOthers?: boolean }) => {
    // The owner's own delete arrives as GroupEndNotification, without `byOthers`.
    if (data.byOthers !== true) return;
    toast(removalNotice(groupName(data.groupId)));
  });
}
