/**
 * Telling the other members what this device now believes about a group.
 *
 * A rename and a role change used to stop at the local store: the protocol has
 * no field for either, so everybody else kept the old name and their own
 * randomly-minted roles. This sends the group's name, role definitions and
 * role assignments as one control envelope (group-control-codec) over the
 * ordinary group-message transport.
 *
 * The whole view, every time, rather than a delta. Receivers take only the
 * parts the sender's role permits (apply-group-control), so a snapshot costs
 * nothing in authority, and it converges a member whose copy has drifted --
 * including one whose roles were minted locally at invite time and share no
 * ids with anyone else's.
 *
 * Only for peer groups: a node-backed channel belongs to the workspace server,
 * which has its own name and roles and would refuse a peer-group key anyway.
 */
import { debugLog } from '@/lib/debug-config';
import { toast } from '@/hooks/use-toast';
import type { GroupConversation } from '@/types/group';
import { encodeGroupControl, type GroupControlBody } from './group-control-codec';
import { groupSendTransport } from './group-send-transport';

export function groupControlSnapshot(group: GroupConversation): GroupControlBody {
  return {
    name: group.name,
    settings: group.settings,
    assignments: group.members.map((member) => ({ cid: member.cid, role_id: member.roleId })),
  };
}

/**
 * The request module is imported lazily, as in reconcile-groups: it reaches the
 * WebSocket service, and the group store binds this module at startup, so a
 * static import put the socket stack in the store's import graph and a unit
 * test of an unread badge constructed a real BroadcastChannel.
 */
export async function sendGroupControl(groupId: string, control: GroupControlBody): Promise<string> {
  const { sendPeerGroupBody } = await import('./group-requests');
  return sendPeerGroupBody(groupId, (senderCid: bigint, messageId: string): Uint8Array => encodeGroupControl({
    group_id: groupId,
    message_id: messageId,
    sender_cid: senderCid,
    timestamp: Date.now(),
    control,
  }));
}

/**
 * Fire-and-report: every caller is a synchronous store update the user can
 * already see, so the send must not block it -- but a failed send means the
 * others were NOT told, and the person who made the change should know that.
 */
export function announceGroupState(group: GroupConversation | undefined): void {
  if (!group || groupSendTransport(group.id) !== 'peer') return;
  sendGroupControl(group.id, groupControlSnapshot(group)).catch((error: unknown) => {
    debugLog('GroupControl', 'Could not share a group change with its members', error);
    toast({
      title: 'Change not shared',
      description: 'The other members were not told about this change. Try again when you are connected.',
      variant: 'destructive',
    });
  });
}
