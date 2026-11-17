/**
 * A member's role as people read it: the table's name and colour for the id they hold.
 *
 * The id is authoritative (`workspace_roles[root]`). The legacy enum on the record is a mirror
 * the server writes for older clients; it is shown only when the id is missing or the table has
 * not arrived, so a badge says "Admin" rather than nothing while the table is on its way.
 */
import type { RoleDefinition, WorkspaceRoles } from 'citadel-workspace-client-ts';
import { roleById } from './role-ladder';

export interface RoleDisplay {
  /** The table id, or the legacy name lower-cased when only the mirror is known. */
  id: string;
  name: string;
  /** `#rrggbb`, or null for the default badge colour. */
  color: string | null;
}

/** The legacy mirror's name: 'Admin', or the name a `{ Custom: [name, rank] }` carries. */
export function legacyRoleName(legacy: unknown): string | null {
  if (typeof legacy === 'string') {
    const trimmed: string = legacy.trim();
    return trimmed === '' ? null : trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }
  if (typeof legacy === 'object' && legacy !== null && 'Custom' in legacy) {
    const custom: unknown = (legacy as { Custom: unknown }).Custom;
    return Array.isArray(custom) && typeof custom[0] === 'string' ? custom[0] : null;
  }
  return null;
}

export function displayRole(
  table: WorkspaceRoles | null,
  roleId: string | null | undefined,
  legacy: unknown,
): RoleDisplay | null {
  const role: RoleDefinition | null = table === null ? null : roleById(table, roleId);
  if (role !== null) return { id: role.id, name: role.name, color: role.color };
  const name: string | null = legacyRoleName(legacy);
  return name === null ? null : { id: name.toLowerCase(), name, color: null };
}
