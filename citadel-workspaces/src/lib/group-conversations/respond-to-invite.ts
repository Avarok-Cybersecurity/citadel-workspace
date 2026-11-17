/**
 * Answering an invitation: the two buttons on a pending invite.
 *
 * Accept is what used to happen unasked -- applyGroupInvite adds the group and
 * sends `GroupRespondRequest { response: true, invitation: true }`.
 *
 * Decline is the same request with `response: false`. The agent turns it into
 * the SDK's `GroupBroadcast::DeclineMembership`, and the server removes the
 * pending member from the group (`remove_pending_peer_from_group`), so a
 * decline is a real refusal at the server and not merely a hidden row. The
 * group is also dropped from this device's list in case any path added it.
 */
import { applyGroupInvite, type GroupInvitePayload } from '@/hooks/use-group-state-invite';
import { toast } from '@/hooks/use-toast';
import { debugLog } from '@/lib/debug-config';
import type { GroupConversation } from '@/types/group';
import { removePendingInvite } from './group-invites';
import { sendGroupRespond } from './group-requests';
import { updateGroups } from './group-store';

export async function acceptGroupInvite(invite: GroupInvitePayload): Promise<void> {
  // Removed first: a second press while the accept is in flight must not send twice.
  removePendingInvite(invite.groupId);
  await applyGroupInvite(invite, updateGroups);
}

export async function declineGroupInvite(invite: GroupInvitePayload): Promise<void> {
  try {
    await sendGroupRespond(invite.groupId, invite.inviterId, false);
  } catch (error) {
    // Kept pending: the server still counts this person invited, and the row
    // is the only way left to answer.
    debugLog('GroupInvites', 'Declining an invitation failed', error);
    toast({
      title: 'Could not decline',
      description: error instanceof Error ? error.message : 'The invitation is still waiting for an answer.',
      variant: 'destructive',
    });
    return;
  }
  removePendingInvite(invite.groupId);
  updateGroups((prev: GroupConversation[]) =>
    prev.some((group) => group.id === invite.groupId) ? prev.filter((group) => group.id !== invite.groupId) : prev,
  );
}
