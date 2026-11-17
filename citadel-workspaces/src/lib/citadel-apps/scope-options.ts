/**
 * Where an app may be installed, for this person, from this page: "Just for me", or the
 * workspace, this page, this page and the pages below it, or chosen people. Each option is offered
 * or not, and when not, says why. The kernel decides (`may_install_at`, audience.rs); this only
 * says in advance what it would refuse, from the permissions the page already holds.
 */
import type { AppAudience, InstallScope, ScopeKind } from 'citadel-workspace-client-ts';
import { Permission, PERMISSION_LABELS } from '@/lib/permissions-service/types';

/** A permission answer: held, not held, or not known yet. */
export type Tri = 'yes' | 'no' | 'unknown';

export interface Authority {
  holds: (permission: Permission, domainId: string) => Tri;
}

/** The picker's choices are the manifest's own scope names. */
export type ScopeChoice = ScopeKind;

export interface ScopeOption {
  choice: ScopeChoice;
  enabled: boolean;
  /** Why it is not offered; null when it is. */
  reason: string | null;
}

export interface ScopeContext {
  scopes: readonly ScopeKind[];
  audience: AppAudience;
  /** The page the marketplace was opened from, or the page a link named; null for none. */
  nodeId: string | null;
  rootId: string;
  authority: Authority;
}

export const SCOPE_ORDER: readonly ScopeChoice[] = ['self', 'workspace', 'node', 'node_tree', 'users'];

const CHECKING: string = 'Checking your permissions…';
const needs = (p: Permission): string => `You need “${PERMISSION_LABELS[p]}”. Ask a workspace admin.`;

function permissionReason(ctx: ScopeContext, checks: ReadonlyArray<readonly [Permission, string]>): string | null {
  const answers: Tri[] = checks.map(([p, domain]) => ctx.authority.holds(p, domain));
  const missing: number = answers.indexOf('no');
  if (missing !== -1) return needs(checks[missing][0]);
  return answers.includes('unknown') ? CHECKING : null;
}

/** Everyone may be given a global or workspace app; anyone narrower cannot get a workspace-wide install. */
const audienceIsEveryone = (a: AppAudience): boolean => a.kind === 'global' || a.kind === 'workspace';

export function scopeOption(choice: ScopeChoice, ctx: ScopeContext): ScopeOption {
  const off = (reason: string): ScopeOption => ({ choice, enabled: false, reason });
  if (!ctx.scopes.includes(choice)) return off('This app cannot be installed this way.');
  if ((choice === 'node' || choice === 'node_tree') && ctx.nodeId === null) return off('Open a page first to install the app there.');
  if (choice === 'workspace' && !audienceIsEveryone(ctx.audience)) return off('Only some people may use this app, so it cannot be installed for everyone.');
  const domain: string = choice === 'node' || choice === 'node_tree' ? (ctx.nodeId as string) : ctx.rootId;
  const checks: ReadonlyArray<readonly [Permission, string]> = choice === 'self'
    ? [[Permission.AppInstall, ctx.rootId]]
    : choice === 'users'
      ? [[Permission.AppInstallScoped, ctx.rootId]]
      : [[Permission.AppInstallScoped, ctx.rootId], [Permission.UpdateNodeSettings, domain]];
  const reason: string | null = permissionReason(ctx, checks);
  return reason === null ? { choice, enabled: true, reason: null } : off(reason);
}

export function scopeOptions(ctx: ScopeContext): ScopeOption[] {
  return SCOPE_ORDER.map((choice: ScopeChoice) => scopeOption(choice, ctx));
}

/** The install scope a choice stands for; null when it needs what is not there. */
export function installScopeOf(choice: ScopeChoice, me: string, nodeId: string | null, people: readonly string[]): InstallScope | null {
  switch (choice) {
    case 'self': return { SelfOnly: me };
    case 'workspace': return 'Workspace';
    case 'node': return nodeId === null ? null : { Node: nodeId };
    case 'node_tree': return nodeId === null ? null : { NodeTree: nodeId };
    case 'users': return people.length === 0 ? null : { Users: [...new Set(people)] };
  }
}

/** The domain whose permissions decide what the installer may grant at `scope`. */
export function scopeDomain(scope: InstallScope, rootId: string): string {
  if (typeof scope === 'object' && 'Node' in scope) return scope.Node;
  if (typeof scope === 'object' && 'NodeTree' in scope) return scope.NodeTree;
  return rootId;
}
