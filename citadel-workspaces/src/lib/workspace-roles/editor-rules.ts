/**
 * Which parts of the role editor the reader may change, from the ladder. Pure: the editor's
 * components only render what these say, and the server still decides.
 *
 *   - A role's column is editable only if `mayEdit` it: never the Owner's, never a role at or
 *     above your own, and only with ManageRoles.
 *   - In an editable column, a ticked box may always be unticked (revoking is never refused),
 *     and an unticked one may be ticked only for a permission you hold yourself.
 */
import type { Permission as WirePermission, RoleDefinition } from 'citadel-workspace-client-ts';
import { Permission } from '@/lib/permissions-service/types';
import { draftGrants } from './role-diff';
import { grantsPermission, isOwnerRole, mayEdit } from './role-ladder';

export const OWNER_FIXED: string = 'The Owner role is fixed.';
export const ACTOR_UNKNOWN: string = 'Checking your role…';
export const NEEDS_MANAGE_ROLES: string = 'Editing roles needs the Manage roles permission.';
export const NOT_BELOW_YOU: string = 'Only roles below your own can be changed.';

/** Why `role` is read-only for `actor`, or null when they may edit it. */
export function columnLock(actor: RoleDefinition | null, role: RoleDefinition): string | null {
  if (isOwnerRole(role)) return OWNER_FIXED;
  if (actor === null) return ACTOR_UNKNOWN;
  if (!grantsPermission(actor, Permission.ManageRoles)) return NEEDS_MANAGE_ROLES;
  // What is left of mayEdit is the position: below yours, or you are the Owner.
  return mayEdit(actor, role) ? null : NOT_BELOW_YOU;
}

export interface CellState {
  checked: boolean;
  editable: boolean;
}

/** One box of the grid: whether the draft grants it, and whether the reader may change it. */
export function cellState(
  actor: RoleDefinition | null,
  role: RoleDefinition,
  draft: ReadonlySet<WirePermission>,
  permission: WirePermission,
): CellState {
  const checked: boolean = draftGrants(draft, permission);
  if (columnLock(actor, role) !== null || actor === null) return { checked, editable: false };
  return { checked, editable: checked || grantsPermission(actor, permission) };
}
