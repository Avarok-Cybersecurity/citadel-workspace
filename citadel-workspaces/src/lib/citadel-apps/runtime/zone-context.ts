/**
 * What an instance is told at `app_init` about where it runs (`AppContext`), and the scope key its
 * install is addressed by: `workspace`, `node:<id>`, `tree:<id>`, `self:<username>`, or `users:`
 * and 32 hex of sha256 over the sorted, distinct usernames joined by newlines, exactly as
 * `InstallScope::scope_key` in citadel-workspace-types computes it.
 */
import type { AppInstall, InstallScope } from 'citadel-workspace-client-ts';
import type { AppContext } from '../sdk/generated/AppContext';
import type { AppScope } from '../sdk/generated/AppScope';
import type { Surface } from '../sdk/generated/Surface';
import type { Capability } from '../host/capabilities';

export function appScopeOf(scope: InstallScope): AppScope {
  if (scope === 'Workspace') return 'workspace';
  if ('Node' in scope) return { node: { node_id: scope.Node } };
  if ('NodeTree' in scope) return { node_tree: { node_id: scope.NodeTree } };
  if ('Users' in scope) return { users: { usernames: [...scope.Users] } };
  return { self_only: { username: scope.SelfOnly } };
}

export async function scopeKeyOf(scope: InstallScope, sha256Hex: (bytes: Uint8Array) => Promise<string>): Promise<string> {
  if (scope === 'Workspace') return 'workspace';
  if ('Node' in scope) return `node:${scope.Node}`;
  if ('NodeTree' in scope) return `tree:${scope.NodeTree}`;
  if ('SelfOnly' in scope) return `self:${scope.SelfOnly}`;
  const distinct: string[] = [...new Set(scope.Users)].sort((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0));
  const digest: string = await sha256Hex(new TextEncoder().encode(distinct.join('\n')));
  return `users:${digest.slice(0, 32)}`;
}

export interface ZonePlacement {
  readonly install: AppInstall;
  /** Where it runs: a zone in a page, or a node tab (runtime/placement.ts). */
  readonly surface: Surface;
  readonly nodeId: string;
  readonly actingUsername: string;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  /** The install's manifest `limits.close_grace_ms`: what the app is told its close may take. */
  readonly closeGraceMs: number;
  readonly locale: string;
  /** Theme token name -> CSS value, as the page resolves them. */
  readonly theme: Readonly<Record<string, string>>;
}

export function zoneContext(p: ZonePlacement): AppContext {
  return {
    app_id: p.install.app_id, install_id: p.install.id, scope: appScopeOf(p.install.scope),
    granted: [...p.install.granted].sort() as Capability[],
    surface: p.surface, size: { width: p.width, height: p.height }, dpr: p.dpr,
    theme: { ...p.theme }, locale: p.locale, acting_username: p.actingUsername, node_id: p.nodeId, close_grace_ms: p.closeGraceMs,
  };
}
