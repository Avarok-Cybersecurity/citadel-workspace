import { groupIdToKey, isValidGroupId } from './group-key';
import { chosenGroupName } from './group-names';
import { peerDisplayName, peerHandleName } from '@/lib/peer-display';
import { createDefaultRoles, getDefaultRole } from '@/types/group';
import type { GroupConversation, GroupMember } from '@/types/group';
import type { GroupRole } from '@/types/group-permissions';

/** Each cid's username, resolved where the roster is, so a store handler need not reach for it. */
export function usernamesOf(cids: readonly bigint[], usernameFor: (cid: bigint) => string): Record<string, string> {
  return Object.fromEntries(cids.map((cid: bigint): [string, string] => [cid.toString(), usernameFor(cid)]));
}

/**
 * The usernames a message's group record would need -- its owner's and its
 * sender's -- resolved where the roster is (group-response-service), so the
 * store that builds the record does not have to reach for it.
 */
export function memberUsernamesFor(payload: Record<string, unknown>, usernameFor: (cid: bigint) => string): Record<string, string> {
  const cids: bigint[] = [];
  if (typeof payload.groupId === 'string' && isValidGroupId(payload.groupId)) cids.push(groupIdToKey(payload.groupId).cid);
  if (typeof payload.senderId === 'string' && /^\d+$/.test(payload.senderId)) cids.push(BigInt(payload.senderId));
  return usernamesOf(cids, usernameFor);
}

/** A lookup over names resolved upstream; a short handle for anyone the roster had not loaded. */
export function usernameFrom(memberUsernames: Record<string, string> | undefined): (cid: bigint) => string {
  return (cid: bigint): string => memberUsernames?.[cid.toString()] ?? peerHandleName({ cid });
}

/**
 * The record for a group this member learnt from a message, before any unread
 * is counted (applyGroupMessage counts the message that brought it).
 *
 * The id says who owns it (`<owner cid>:<mgid>`); the members known so far are
 * the owner, this member and the sender. The name is the one the owner sent
 * with the message, or the same default an invitation gets.
 */
export function memberGroupRecord(input: {
  groupId: string;
  groupName?: string;
  senderId: string;
  self: bigint | null;
  selfUsername?: string;
  usernameFor: (cid: bigint) => string;
}): GroupConversation {
  const owner: bigint = groupIdToKey(input.groupId).cid;
  const roles: GroupRole[] = createDefaultRoles();
  const memberRole: GroupRole = getDefaultRole({ roles, defaultRoleId: '' }) ?? roles[roles.length - 1];
  const joinedAt: number = Date.now();

  const cids: bigint[] = [owner];
  if (input.self !== null && input.self !== owner) cids.push(input.self);
  const sender: bigint | null = /^\d+$/.test(input.senderId) ? BigInt(input.senderId) : null;
  if (sender !== null && !cids.includes(sender)) cids.push(sender);

  const members: GroupMember[] = cids.map((cid: bigint): GroupMember => ({
    cid,
    username: cid === input.self && input.selfUsername ? input.selfUsername : input.usernameFor(cid),
    roleId: cid === owner ? roles[0].id : memberRole.id,
    joinedAt,
  }));

  return {
    id: input.groupId,
    name: input.groupName ?? chosenGroupName(input.groupId) ?? `${peerDisplayName(members[0])}'s Group`,
    ownerId: owner,
    members,
    settings: { roles, defaultRoleId: memberRole.id },
    unreadCount: 0,
  };
}
