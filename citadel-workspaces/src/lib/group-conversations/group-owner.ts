/**
 * Who owns a peer group, as the server last reported it.
 *
 * The group key names the group's CREATOR, and stays the same for the group's life: when the
 * owner leaves, the server passes the group to a member and keeps the key. So the owner is the
 * store's `ownerId`, set from the agent's joined list (`owners`) and from each ownership
 * transfer, and every permission or name check reads it from there, never from the key.
 *
 * Pure: the store hands its groups in, and identity is the no-op (see mark-group-read).
 */
import type { GroupConversation, GroupMember } from '@/types/group';

/** `groups` with `groupId` owned by `owner`, who takes the Owner role if a member here. */
export function withOwner(groups: GroupConversation[], groupId: string, owner: bigint): GroupConversation[] {
  const group: GroupConversation | undefined = groups.find((g: GroupConversation): boolean => g.id === groupId);
  if (group === undefined || group.ownerId === owner) return groups;
  // The first default role is the Owner's (createDefaultRoles); the one who left keeps none of it.
  const ownerRole: string | undefined = group.settings.roles[0]?.id;
  const memberRole: string = group.settings.defaultRoleId;
  const members: GroupMember[] = group.members.map((m: GroupMember): GroupMember => {
    if (m.cid === owner && ownerRole !== undefined) return { ...m, roleId: ownerRole };
    if (m.cid === group.ownerId && m.roleId === ownerRole) return { ...m, roleId: memberRole };
    return m;
  });
  return groups.map((g: GroupConversation): GroupConversation => (g.id === groupId ? { ...g, ownerId: owner, members } : g));
}

/** Every listed owner applied in turn; `groups` when none changes. */
export function withOwners(groups: GroupConversation[], owners: ReadonlyMap<string, bigint>): GroupConversation[] {
  let next: GroupConversation[] = groups;
  for (const [groupId, owner] of owners) next = withOwner(next, groupId, owner);
  return next;
}
