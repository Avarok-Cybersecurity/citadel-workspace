/**
 * An arriving invitation becomes a question, not a membership.
 *
 * This handler used to call applyGroupInvite, joining the group on the
 * person's behalf. Now it records the invitation (group-invites) and says who
 * sent it; the sidebar offers Accept and Decline (respond-to-invite).
 *
 * An invitation for a group already in the list is ignored -- the person is a
 * member, and a second row asking them to join would be a question with no
 * meaningful answer. A group that ends while its invitation is pending takes
 * the invitation with it.
 */
import { eventEmitter } from '@/lib/event-emitter';
import { toast } from '@/hooks/use-toast';
import { debugLog } from '@/lib/debug-config';
import { inviteTarget, type GroupInvitePayload } from '@/hooks/use-group-state-invite';
import { addPendingInvite, removePendingInvite } from './group-invites';

export function bindGroupInvites(isMemberOf: (groupId: string) => boolean): void {
  eventEmitter.on('group:invite-received', (data: GroupInvitePayload) => {
    debugLog('GroupStore', 'Invite received:', data);
    // Same rule buildGroupFromInvite applies: an invitation from nobody is malformed.
    if (!data.groupId || !data.inviterUsername || isMemberOf(data.groupId)) return;
    if (!addPendingInvite(data)) return;
    toast({ title: 'Group Invitation', description: `${data.inviterUsername} invited you to ${inviteTarget(data)}` });
  });

  eventEmitter.on('group:deleted', (data: { groupId: string }) => {
    removePendingInvite(data.groupId);
  });
}
