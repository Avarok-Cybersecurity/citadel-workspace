/** The admin tab's member row, as the subject of the shared one-member permission editor. */
import type { PermissionSubject } from '@/components/permissions/MemberPermissionsDialog';
import type { MemberData } from '../types';

export function asPermissionSubject(member: MemberData): PermissionSubject {
  return { id: member.userId, username: member.username, displayName: member.name || member.username, role: member.role, roleId: member.roleId };
}
