import type { WorkspaceEventState } from '../WorkspaceEventHandler';
import type { DomainNode } from '@/components/layout/sidebar/TreeNodesSection';
// Re-export runAsyncSetup from canonical location for backward compatibility
export { runAsyncSetup } from '@/lib/utils/async-utils';

type SetState = React.Dispatch<React.SetStateAction<WorkspaceEventState>>;

/** Set a loading flag and optionally track the request ID. */
export function setLoading(
  setState: SetState,
  key: keyof WorkspaceEventState['loading'],
  loading: boolean,
): void {
  setState(prev => ({
    ...prev,
    loading: { ...prev.loading, [key]: loading },
  }));
}

/**
 * No-op kept as a call site marker.
 *
 * This used to write the request id into `lastRequestId`, a field written in
 * 24 places and read in none — so "track a request ID without changing other
 * state" was a root re-render of every useWorkspace() consumer in exchange for
 * nothing. The parameters stay so the call sites still document which events
 * carry a request id.
 */
export function trackRequest(_setState: SetState, _requestId?: string): void {
  // Intentionally empty.
}

/** Upsert a DomainNode into the nodes map by its id. */
export function upsertNode(
  setState: SetState,
  node: DomainNode,
): void {
  setState(prev => {
    // "Exactly one node is the default" is the server's invariant: setting
    // `is_default` on one node clears it on every other, under the same lock and
    // the same save. But the broadcast carries only the node that was SET, so a
    // client applying it learns the new default and never learns the old one was
    // cleared -- leaving two flagged nodes, with `Office.tsx` resolving the
    // landing room by `find(n => n.is_default)`, whichever comes first.
    //
    // Only on `true`. Clearing here for every upsert would wipe the default
    // whenever any unrelated node was renamed, and `is_default: false` on the
    // current default is a legitimate request that must not promote something
    // else -- the same rule the server states at its own write.
    const nodes: Record<string, DomainNode> = { ...prev.nodes, [node.id]: node };
    if (node.is_default) {
      for (const [id, existing] of Object.entries(nodes)) {
        if (id !== node.id && existing.is_default) {
          nodes[id] = { ...existing, is_default: false };
        }
      }
    }
    return { ...prev, nodes };
  });
}

/** Remove a node and its cascaded children from the nodes map. */
export function removeNode(
  setState: SetState,
  nodeId: string,
  childrenDeleted: string[],
): void {
  setState(prev => {
    const updated: { [x: string]: DomainNode; } = { ...prev.nodes };
    delete updated[nodeId];
    for (const childId of childrenDeleted) {
      delete updated[childId];
    }
    return {
      ...prev,
      nodes: updated,
    };
  });
}

/**
 * The node set a full `Nodes` answer describes. It replaced nothing -- it was merged into
 * the previous set -- so a workspace switch kept the last workspace's offices (measured
 * live). The only request answered with `Nodes` is post-auth setup's unfiltered ListNodes.
 */
export function nodesFromList(nodes: readonly DomainNode[]): Record<string, DomainNode> {
  const byId: Record<string, DomainNode> = {};
  for (const node of nodes) byId[node.id] = node;
  return byId;
}
