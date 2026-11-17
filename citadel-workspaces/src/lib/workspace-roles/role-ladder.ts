/**
 * The role ladder, mirrored from the server so the UI stops offering what it would refuse.
 *
 * The server is authoritative (`role_edits` and `role_authority` in
 * citadel-workspace-server-kernel). Every rule here asks a role's POSITION and its
 * PERMISSIONS, never its name: names are the admin's to change, and a renamed "Admin" is
 * still the role at position 300 holding `All`.
 *
 *   - outranks: the Owner outranks everything; anyone else, only what is strictly below.
 *   - edit / delete: needs ManageRoles; never the Owner role, never at or above your own.
 *   - assign: below you and carrying nothing you lack (the Owner assigns anything), or the
 *     vacant Owner seat for someone holding everything the Owner does.
 *   - act on a member: their role is below yours, or you are the Owner, or it is you.
 *   - the role new members get: one you may edit and could assign; never the Owner, so
 *     deleting it cannot move its holders onto the Owner.
 */
import type { Permission as WirePermission, RoleDefinition, WorkspaceRoles } from 'citadel-workspace-client-ts';

/** The built-in Owner role's id. An id, which the server fixes, not a name, which admins edit. */
export const OWNER_ROLE_ID: string = 'owner';

const ALL: WirePermission = 'All';
const MANAGE_ROLES: WirePermission = 'ManageRoles';

export function roleById(table: WorkspaceRoles, id: string | null | undefined): RoleDefinition | null {
  if (!id) return null;
  return table.roles.find((role: RoleDefinition): boolean => role.id === id) ?? null;
}

/** The acting user's role: the table entry their `workspace_roles[root]` names. */
export function actorRole(table: WorkspaceRoles, roleId: string | null | undefined): RoleDefinition | null {
  return roleById(table, roleId);
}

export function isOwnerRole(role: RoleDefinition): boolean {
  return role.id === OWNER_ROLE_ID;
}

/** Whether `role` confers `permission`, `All` covering everything. */
export function grantsPermission(role: RoleDefinition, permission: WirePermission): boolean {
  return role.permissions.includes(ALL) || role.permissions.includes(permission);
}

/** Whether `holder` confers every one of `permissions`. */
export function coversAll(holder: RoleDefinition, permissions: readonly WirePermission[]): boolean {
  return permissions.every((permission: WirePermission): boolean => grantsPermission(holder, permission));
}

/** Whether `actor` may act on a role at `position`. */
export function outranks(actor: RoleDefinition, position: number): boolean {
  return isOwnerRole(actor) || position < actor.position;
}

/** Whether `actor` may rename, recolour, move, re-permission or delete `role`. */
export function mayEdit(actor: RoleDefinition, role: RoleDefinition): boolean {
  return grantsPermission(actor, MANAGE_ROLES) && !isOwnerRole(role) && outranks(actor, role.position);
}

/**
 * Whether `actor` may hand `role` to a member.
 *
 * `occupied` is the set of role ids root members hold, or null while the roster is unknown:
 * an unknown roster is not evidence of a vacancy, so it fills no seat.
 */
export function mayAssign(actor: RoleDefinition, role: RoleDefinition, occupied: ReadonlySet<string> | null): boolean {
  if (isOwnerRole(actor)) return true;
  if (role.position < actor.position) return coversAll(actor, role.permissions);
  return isOwnerRole(role) && coversAll(actor, role.permissions) && occupied !== null && !occupied.has(OWNER_ROLE_ID);
}

/**
 * Whether a deleted role's holders may be moved to `target`: `role_edits::delete`. Deleting the
 * role new members get makes `target` the default, so then it cannot be the Owner.
 */
export function mayReassignTo(table: WorkspaceRoles, actor: RoleDefinition, deleting: RoleDefinition, target: RoleDefinition): boolean {
  if (target.id === deleting.id || !outranks(actor, target.position)) return false;
  if (deleting.id === table.default_role_id && isOwnerRole(target)) return false;
  return isOwnerRole(actor) || coversAll(actor, target.permissions);
}

/** The role new members get; null only for a table that breaks the server's invariant. */
export function defaultRole(table: WorkspaceRoles): RoleDefinition | null {
  return roleById(table, table.default_role_id);
}

/** Whether `actor` may make `role` the one new members get: `RoleChange::MakeDefault`. */
export function mayMakeDefault(actor: RoleDefinition, role: RoleDefinition): boolean {
  return mayEdit(actor, role) && (isOwnerRole(actor) || coversAll(actor, role.permissions));
}

/**
 * Whether `actor` may change, strip, remove or ban a member holding `target`.
 *
 * A member with no role in the table (banned, or not a member) is below everyone.
 */
export function mayActOn(actor: RoleDefinition, target: RoleDefinition | null, isSelf: boolean): boolean {
  if (isSelf || isOwnerRole(actor)) return true;
  return (target?.position ?? 0) < actor.position;
}

/** How many of `memberRoleIds` hold a role that may manage roles. */
export function managerCount(table: WorkspaceRoles, memberRoleIds: readonly (string | null | undefined)[]): number {
  return memberRoleIds.filter((id: string | null | undefined): boolean => {
    const role: RoleDefinition | null = roleById(table, id);
    return role !== null && grantsPermission(role, MANAGE_ROLES);
  }).length;
}

/**
 * Whether the member holding `roleId` is the last root member able to manage roles.
 *
 * The server refuses removing, demoting or banning them ("managers remain"), since nobody
 * could ever manage roles again.
 */
export function isOnlyManager(
  table: WorkspaceRoles,
  memberRoleIds: readonly (string | null | undefined)[],
  roleId: string | null | undefined,
): boolean {
  const role: RoleDefinition | null = roleById(table, roleId);
  if (role === null || !grantsPermission(role, MANAGE_ROLES)) return false;
  return managerCount(table, memberRoleIds) === 1;
}

/**
 * The roles `actor` may hand out, highest first. An unknown actor withholds nothing (the
 * server's refusal is shown in its words); an unknown roster fills no vacant seat.
 */
export function assignableRoles(
  table: WorkspaceRoles,
  actor: RoleDefinition | null,
  occupied: ReadonlySet<string> | null,
): RoleDefinition[] {
  return table.roles.filter((role: RoleDefinition): boolean => actor === null || mayAssign(actor, role, occupied));
}
