/**
 * Permissions Service - Cache Operations
 *
 * Cache management, permission checks, and role queries.
 * Pure functions operating on a cache Map.
 */

import { debugLog } from '@/lib/debug-config';
import { Permission, PERMISSION_LABELS } from './types';
import type { UserRole, DomainPermissions } from './types';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';

/**
 * The permissions the server can name, as a set.
 *
 * `Object.values(Permission)` allocates a fresh array on every call, and the call sat inside a
 * loop over the permissions of one domain — so checking a member's grants allocated one array
 * per permission. Hoisted: the enum does not change at runtime.
 */
const KNOWN_PERMISSIONS: Set<Permission> = new Set(Object.values(Permission));

/**
 * Parse raw permission strings into a Permission Set, filtering unknown values.
 */
export function parsePermissionSet(permissions: string[]): Set<Permission> {
  const permSet: Set<Permission> = new Set<Permission>();
  for (const perm of permissions) {
    if (KNOWN_PERMISSIONS.has(perm as Permission)) {
      permSet.add(perm as Permission);
    }
  }
  return permSet;
}

/**
 * Update the cache entry for a domain.
 */
export function updateCacheEntry(
  cache: Map<string, DomainPermissions>,
  domainId: string,
  role: UserRole,
  permissions: string[],
): void {
  const permSet: Set<Permission> = parsePermissionSet(permissions);

  cache.set(domainId, {
    domainId,
    role,
    permissions: permSet,
    lastUpdated: Date.now(),
  });

  debugLog('PermissionsService', `Cache updated for ${domainId}: ${permSet.size} permissions`);
}

/**
 * Check if user has a specific permission for a domain.
 *
 * Checks in order:
 * 1. Exact domain cache entry - explicit Permission.All wildcard
 * 2. Exact domain cache entry - specific permission in set
 * 3. Hierarchy fallback - traverse to 'workspace-root' for inherited permissions
 *
 * No role NAME is consulted. The server's answer is what enforcement would allow, its role
 * included, and a role is whatever its table entry grants: an "Admin" an administrator has
 * stripped is not all-powerful, and an Owner does not hold ConfigureSystem.
 */
export function hasPermission(
  cache: Map<string, DomainPermissions>,
  domainId: string,
  permission: Permission,
): boolean {
  const cached: DomainPermissions | undefined = cache.get(domainId);

  if (cached) {
    if (cached.permissions.has(Permission.All)) return true;
    if (cached.permissions.has(permission)) return true;
  }

  // Hierarchy fallback: check workspace-root for inherited permissions
  if (domainId !== WORKSPACE_ROOT_ID) {
    const root: DomainPermissions | undefined = cache.get(WORKSPACE_ROOT_ID);
    if (root) {
      if (root.permissions.has(Permission.All)) return true;
      return root.permissions.has(permission);
    }
  }

  return false;
}

/**
 * Whether an answer for this domain exists at all.
 *
 * `hasPermission` returns `false` for a cache MISS, which is indistinguishable
 * from "we asked and you may not". Every caller that renders a denial needs to
 * know the difference: an office chat gated on `SendMessages` replaced its
 * composer with "You do not have permission to send messages here" for every
 * user in a three-user run, because the answer had never been stored.
 *
 * The whole INHERITANCE CHAIN has to have answered, not just the domain asked
 * about. `hasPermission` denies on the domain's own entry and only then falls
 * back to the workspace root — so a node that grants nothing while the root has
 * never been fetched produces a definite-looking refusal for a permission the
 * root may well confer.
 *
 * CI showed exactly that: an office chat composer replaced by "You do not have
 * permission to send messages here" for a user whose role grants it.
 *
 * A root entry alone still counts, because a domain with no entry of its own is
 * answered entirely by the fallback. What does not count is a domain entry
 * without the root behind it.
 */
export function hasAnswerFor(
  cache: Map<string, DomainPermissions>,
  domainId: string,
): boolean {
  if (domainId === WORKSPACE_ROOT_ID) return cache.has(WORKSPACE_ROOT_ID);
  if (cache.has(WORKSPACE_ROOT_ID)) return true;
  // The domain answered and the root did not, so a denial here is not yet a
  // fact: the permission it withheld may be inherited.
  return false;
}


/**
 * Get reason message for denied permission.
 */
export function getDeniedReason(
  cache: Map<string, DomainPermissions>,
  domainId: string,
  permission: Permission,
): string {
  const cached: DomainPermissions | undefined = cache.get(domainId);
  if (!cached) {
    return 'Permissions have not been loaded for this domain';
  }

  const label: string = PERMISSION_LABELS[permission] || permission;
  return `You don't have the "${label}" permission here.`;
}
