/**
 * What Save sends for one role: exactly the changes the editor made, and nothing it did not.
 *
 * `Update` is all-or-nothing per request, but two administrators editing different fields of
 * one role must not overwrite each other, so an unchanged name is not re-sent as a Rename, and
 * a permission left alone appears in neither Grant nor Revoke.
 *
 * The one subtlety is `All`. The server revokes from a role holding the wildcard by first
 * spelling it out as every permission (`role_edits::revoke`), so unticking one box on such a
 * role is `Revoke [that one]` and the role keeps the rest. Revokes go before grants: granting
 * `All` and then revoking would spell the new wildcard straight back out.
 */
import type { Permission as WirePermission, RoleChange, RoleDefinition } from 'citadel-workspace-client-ts';
import { ALL_PERMISSIONS, Permission } from '@/lib/permissions-service/types';

/** The editable fields of one role, as the editor holds them before Save. */
export interface RoleDraft {
  name: string;
  color: string | null;
  permissions: ReadonlySet<WirePermission>;
}

const EVERY_BUT_ALL: readonly WirePermission[] = ALL_PERMISSIONS.filter((p: Permission): boolean => p !== Permission.All);

export function draftOf(role: RoleDefinition): RoleDraft {
  return { name: role.name, color: role.color, permissions: new Set(role.permissions) };
}

/** Whether a draft's set confers `permission`, as a role holding it would. */
export function draftGrants(permissions: ReadonlySet<WirePermission>, permission: WirePermission): boolean {
  return permissions.has(Permission.All) || permissions.has(permission);
}

/**
 * The set after ticking (`on`) or unticking one box.
 *
 * Unticking a permission the wildcard covers spells the wildcard out, as the server will;
 * unticking `All` itself takes only the wildcard away. Ticking under the wildcard changes nothing.
 */
export function togglePermission(
  permissions: ReadonlySet<WirePermission>,
  permission: WirePermission,
  on: boolean,
): Set<WirePermission> {
  const next: Set<WirePermission> = new Set(permissions);
  if (on) {
    if (!permissions.has(Permission.All)) next.add(permission);
    return next;
  }
  if (permission !== Permission.All && permissions.has(Permission.All)) {
    return new Set(EVERY_BUT_ALL.filter((p: WirePermission): boolean => p !== permission));
  }
  next.delete(permission);
  return next;
}

function permissionChanges(before: ReadonlySet<WirePermission>, after: ReadonlySet<WirePermission>): RoleChange[] {
  if (before.has(Permission.All)) {
    if (after.has(Permission.All)) {
      const grant: WirePermission[] = [...after].filter((p: WirePermission): boolean => !before.has(p));
      return grant.length > 0 ? [{ Grant: grant }] : [];
    }
    // The server keeps every permission but the revoked ones once the wildcard is spelled out.
    const revoke: WirePermission[] = EVERY_BUT_ALL.filter((p: WirePermission): boolean => !after.has(p));
    if (after.size === 0) return [{ Revoke: [Permission.All] }];
    return revoke.length > 0 ? [{ Revoke: revoke }] : [{ Revoke: [Permission.All] }, { Grant: [...after] }];
  }
  const revoke: WirePermission[] = [...before].filter((p: WirePermission): boolean => !after.has(p));
  const grant: WirePermission[] = [...after].filter((p: WirePermission): boolean => !before.has(p));
  const changes: RoleChange[] = [];
  if (revoke.length > 0) changes.push({ Revoke: revoke });
  if (grant.length > 0) changes.push({ Grant: grant });
  return changes;
}

/** The `Update.changes` that turn `before` into `draft`; empty when nothing changed. */
export function roleChanges(before: RoleDefinition, draft: RoleDraft): RoleChange[] {
  const changes: RoleChange[] = [];
  const name: string = draft.name.trim();
  if (name !== before.name) changes.push({ Rename: name });
  if (draft.color !== before.color) changes.push({ Recolor: draft.color });
  return [...changes, ...permissionChanges(new Set(before.permissions), draft.permissions)];
}
