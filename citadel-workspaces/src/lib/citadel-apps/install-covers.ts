/**
 * Whether an install reaches this person on this page: the one rule an app zone, an app tab and
 * the marketplace's tab view all decide by, as the kernel's `InstallScope` coverage does.
 */
import type { InstallScope } from 'citadel-workspace-client-ts';

/** `ancestors`: the page's ancestors, nearest first. */
export function covers(scope: InstallScope, me: string, nodeId: string, ancestors: readonly string[]): boolean {
  if (scope === 'Workspace') return true;
  if ('SelfOnly' in scope) return scope.SelfOnly === me;
  if ('Users' in scope) return scope.Users.includes(me);
  if ('Node' in scope) return scope.Node === nodeId;
  return scope.NodeTree === nodeId || ancestors.includes(scope.NodeTree);
}
