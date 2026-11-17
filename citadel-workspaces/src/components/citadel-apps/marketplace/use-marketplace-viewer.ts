/**
 * The marketplace's view of this person, from the workspace state the page already holds and the
 * permission answers its probes gathered (PermissionProbes.tsx): who they are, the page they are
 * on, what they may do where, and how far a scope would reach.
 */
import { useMemo } from 'react';
import type { InstallScope } from 'citadel-workspace-client-ts';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { ancestorIdsOf, descendantCount } from '@/components/layout/sidebar/tree-node-utils';
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';
import type { Authority } from '@/lib/citadel-apps/scope-options';
import type { Reach } from '@/lib/citadel-apps/scope-sentence';
import type { MarketplaceViewer } from './marketplace-types';

export function useMarketplaceViewer(nodeId: string | null, serverAddress: string | null, authority: Authority): MarketplaceViewer | null {
  const { state } = useWorkspace();
  const me: string | undefined = state.currentUser?.username;

  return useMemo((): MarketplaceViewer | null => {
    if (me === undefined) return null;
    const nodes: DomainNode[] = Object.values(state.nodes);
    const memberCount: number | null = state.loading.members ? null : Object.keys(state.members).length;
    const reach = (scope: InstallScope): Reach => {
      if (scope === 'Workspace') return { people: memberCount, pagesBelow: null };
      if ('SelfOnly' in scope) return { people: 1, pagesBelow: null };
      if ('Users' in scope) return { people: scope.Users.length, pagesBelow: null };
      if ('NodeTree' in scope) return { people: null, pagesBelow: descendantCount(nodes, scope.NodeTree) };
      return { people: null, pagesBelow: null };
    };
    return {
      me, rootId: WORKSPACE_ROOT_ID, nodeId,
      nodeName: (id: string): string | null => state.nodes[id]?.name ?? null,
      ancestors: (id: string): readonly string[] => ancestorIdsOf(state.nodes, id),
      authority, reach,
      members: Object.values(state.members).map((u: { id: string }) => u.id).sort(),
      serverAddress, origin: window.location.origin,
    };
  }, [me, nodeId, serverAddress, state.nodes, state.members, state.loading.members, authority]);
}
