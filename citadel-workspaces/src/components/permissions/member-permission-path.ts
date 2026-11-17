/**
 * Where one member's permissions come from, read off the server's answers.
 *
 * The server reports, for each level, what enforcement would allow there:
 * admin short-circuit, direct grant, then inheritance up the parent chain
 * (`GetUserPermissions` in the server kernel). Nothing here re-derives those
 * rules. It only lines the answers up along the path from the workspace down to
 * the node the editor was opened from, and asks which level is the highest one
 * already granting a permission: that level is where it comes from, because a
 * grant there reaches everything beneath it.
 *
 * The path itself is lib/domain-path.ts, shared with the header's breadcrumbs.
 *
 * Pure: the nodes and the answers are the caller's.
 */
import type { DomainLevel } from '@/lib/domain-path';
import type { PermissionsLoad } from './use-loaded-permissions';

/** One level on the path (lib/domain-path.ts), as the permission editor names it. */
export type PermissionLevel = DomainLevel;

/** Where a permission the member holds at the edited level comes from — or that they do not hold it. */
export type GrantSource =
  | { kind: 'here' }
  | { kind: 'inherited'; from: PermissionLevel }
  | { kind: 'none' };

/** "Office HQ"; just the name when the kind is unknown. */
export const levelPhrase = (level: PermissionLevel): string => [level.kind, level.name].filter(Boolean).join(' ');

/** Every level answered; until then nothing is known about where a grant comes from. */
export function allLoaded(
  path: readonly PermissionLevel[],
  loads: Readonly<Record<string, PermissionsLoad>>,
): boolean {
  return path.every((level: PermissionLevel): boolean => loads[level.id]?.status === 'loaded');
}

const grants = (load: PermissionsLoad | undefined, permission: string): boolean =>
  load?.status === 'loaded' && load.permissions.has(permission);

/**
 * Where `permission` comes from at the last level of `path`: the highest level
 * above it that already grants it, else the level itself, else nowhere. Null
 * while any level is unanswered.
 */
export function grantSource(
  permission: string,
  path: readonly PermissionLevel[],
  loads: Readonly<Record<string, PermissionsLoad>>,
): GrantSource | null {
  if (!allLoaded(path, loads)) return null;
  const from: PermissionLevel | undefined = path.slice(0, -1).find((level: PermissionLevel): boolean => grants(loads[level.id], permission));
  if (from) return { kind: 'inherited', from };
  return grants(loads[path[path.length - 1].id], permission) ? { kind: 'here' } : { kind: 'none' };
}
