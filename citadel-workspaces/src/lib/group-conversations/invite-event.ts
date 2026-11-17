/**
 * One invitation, as the event the sidebar turns into an Accept/Decline question.
 *
 * Built in one place for both ways an invitation arrives: live (`GroupInviteNotification`) and
 * listed by the agent for a tab that was closed when it came (`GroupListJoinedSuccess
 * .pending_invites`). Two builders would drift, and the listed one is the one nobody sees fail.
 */
import { groupKeyToId, parseGroupKey } from './group-key';
import type { GroupEvent, PeerNameResolver } from './group-events';

export function inviteReceived(groupKey: unknown, inviter: unknown, peerName: PeerNameResolver): GroupEvent {
  const inviterCid: bigint = BigInt((inviter ?? 0) as string | number | bigint);
  return {
    name: 'group:invite-received',
    payload: {
      groupId: groupKeyToId(parseGroupKey(groupKey)),
      groupName: '',
      inviterId: inviterCid.toString(),
      inviterUsername: peerName(inviterCid),
    },
  };
}
