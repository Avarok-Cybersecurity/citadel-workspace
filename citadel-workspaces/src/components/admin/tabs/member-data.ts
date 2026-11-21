/** The admin tab's member rows: from the server's records, and as the subject of the shared one-member permission editor. */
import type { PermissionSubject } from '@/components/permissions/MemberPermissionsDialog';
import type { WorkspaceMember } from '@/types/workspace-entities';
import type { MemberData } from '../types';

/** A member as the server listed them, as a row of the tab. */
export function asMemberData(m: WorkspaceMember, where: { accessViaName: string | undefined; isGuest: boolean }): MemberData {
  return { userId: m.id, username: m.username, name: m.displayName, avatarUrl: m.avatarUrl, banned: m.banned, roleId: m.roleId, ...where };
}

export function asPermissionSubject(member: MemberData): PermissionSubject {
  return { id: member.userId, username: member.username, displayName: member.name || member.username, banned: member.banned, roleId: member.roleId };
}
