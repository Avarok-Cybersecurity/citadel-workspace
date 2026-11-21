/**
 * A member's role as people read it: the table's name and colour for the id they hold.
 *
 * The id is authoritative (`workspace_roles[root]`). A ban is a standing, not a role, so a banned
 * member reads as "Banned" whatever id a stale copy names. The signed-in user's role name is also
 * remembered with their session; it is shown only when the id is missing or the table has not
 * arrived, so a badge says "Admin" rather than nothing while the table is on its way.
 */
import type { RoleDefinition, WorkspaceRoles } from 'citadel-workspace-client-ts';
import { roleById } from './role-ladder';

/**
 * A role as a badge shows it. `id` is the table id, `banned` for a ban, or the remembered name
 * lower-cased when only that is known; `color` is `#rrggbb`, or null for the default badge colour.
 */
export type RoleDisplay = Pick<RoleDefinition, 'id' | 'name' | 'color'>;

/** Whom a badge describes: their role id, their ban, and the role name their session remembers. */
export interface RoleHolder {
  /** Their role-table id; see lib/workspace-roles. */
  roleId?: string;
  /** Banned from the workspace: shown in place of any role. */
  banned?: boolean;
  /** The role's name as remembered with the session, shown only when the id is not known. */
  role?: string;
}

export const BANNED_DISPLAY: RoleDisplay = { id: 'banned', name: 'Banned', color: null };

/** A remembered role name as a badge reads it: 'Admin'; null when there is none. */
export function rememberedRoleName(remembered: string | undefined): string | null {
  const trimmed: string = remembered?.trim() ?? '';
  return trimmed === '' ? null : trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function displayRole(table: WorkspaceRoles | null, holder: RoleHolder): RoleDisplay | null {
  if (holder.banned === true) return BANNED_DISPLAY;
  const role: RoleDefinition | null = table === null ? null : roleById(table, holder.roleId);
  if (role !== null) return { id: role.id, name: role.name, color: role.color };
  const name: string | null = rememberedRoleName(holder.role);
  return name === null ? null : { id: name.toLowerCase(), name, color: null };
}
