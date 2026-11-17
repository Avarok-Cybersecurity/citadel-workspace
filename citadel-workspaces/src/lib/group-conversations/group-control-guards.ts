/**
 * Who may change what, judged on the RECEIVER's own copy of the group.
 *
 * The sender's claim about its own role is exactly what cannot be trusted: a
 * member who could send "I am an admin, and here are the new roles" would be
 * an admin. So the permission is looked up in the roles this device already
 * holds, for the cid the protocol says sent the message.
 *
 * The owner -- the cid the group key names -- is always permitted. Anyone else
 * also meets the hierarchy: no role at or above their own may be created,
 * edited, removed or handed out by them. Without that, `manageRoles` could
 * grant itself `deleteGroup`, and `assignRoles` could assign the Owner role.
 */
import type { GroupConversation, GroupRole, GroupSettings } from '@/types/group';
import type { GroupPermissions } from '@/types/group-permissions';

export interface SenderStanding {
  isOwner: boolean;
  /** The sender's role in the receiver's copy; undefined for a non-member. */
  role: GroupRole | undefined;
}

export function senderStanding(group: GroupConversation, senderCid: bigint, ownerCid: bigint): SenderStanding {
  const roleId: string | undefined = group.members.find((m) => m.cid === senderCid)?.roleId;
  return {
    isOwner: senderCid === ownerCid,
    role: roleId === undefined ? undefined : group.settings.roles.find((r) => r.id === roleId),
  };
}

export function mayDo(standing: SenderStanding, permission: keyof GroupPermissions): boolean {
  return standing.isOwner || standing.role?.permissions[permission] === true;
}

function sameRole(a: GroupRole, b: GroupRole): boolean {
  if (a.id !== b.id || a.name !== b.name || a.position !== b.position || a.color !== b.color) return false;
  if (a.isDefault !== b.isDefault || a.isBuiltIn !== b.isBuiltIn) return false;
  return (Object.keys(a.permissions) as Array<keyof GroupPermissions>)
    .every((key) => a.permissions[key] === b.permissions[key]);
}

export function sameSettings(a: GroupSettings, b: GroupSettings): boolean {
  return a.defaultRoleId === b.defaultRoleId
    && a.roles.length === b.roles.length
    && a.roles.every((role, i) => sameRole(role, b.roles[i]));
}

/** Every role at or above the sender survives unchanged, and nothing new lands there. */
export function rolesChangeBelowSender(before: GroupSettings, after: GroupSettings, standing: SenderStanding): boolean {
  if (standing.isOwner) return true;
  const ceiling: number | undefined = standing.role?.position;
  if (ceiling === undefined) return false;
  const kept: boolean = before.roles
    .filter((role) => role.position >= ceiling)
    .every((role) => after.roles.some((next) => sameRole(role, next)));
  const added: boolean = after.roles
    .filter((next) => !before.roles.some((role) => sameRole(role, next)))
    .every((next) => next.position < ceiling);
  return kept && added;
}

/** Moving a member from `from` to `to` is within the sender's reach. */
export function assignmentWithinReach(from: GroupRole | undefined, to: GroupRole, standing: SenderStanding): boolean {
  if (standing.isOwner) return true;
  const ceiling: number | undefined = standing.role?.position;
  if (ceiling === undefined) return false;
  return to.position < ceiling && (from === undefined || from.position < ceiling);
}
