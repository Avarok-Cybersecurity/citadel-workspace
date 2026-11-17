import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';

/**
 * Where a node may legally be moved.
 *
 * Computed on the client so the picker only ever offers valid destinations —
 * the server refuses the rest, and an offer the server will refuse is worse
 * than no offer at all.
 *
 * Three rules, all of them about not corrupting the tree:
 *
 *  - Not itself. Trivially, and it would orphan the node.
 *  - Not any of its own descendants. Moving a parent into its own child makes a
 *    cycle, and the tree walk that renders the sidebar would either drop the
 *    whole branch or recurse. `buildTreeFromNodes` guards against cycles by
 *    dropping them, so the visible symptom would be a subtree that silently
 *    disappears.
 *  - Not a parent that will not have it. `allowed_child_types` is the schema's
 *    own answer to what may live where.
 */
export function moveTargets(
  nodes: Record<string, DomainNode>,
  nodeId: string,
): DomainNode[] {
  const node: DomainNode = nodes[nodeId];
  if (!node) return [];

  const forbidden: Set<string> = descendantsOf(nodes, nodeId);
  forbidden.add(nodeId);

  const childType: string | null = childTypeOf(node);

  return Object.values(nodes).filter((candidate) => {
    if (forbidden.has(candidate.id)) return false;
    if (candidate.id === node.parent_id) return false;
    if (!childType) return true;
    return (candidate.allowed_child_types ?? []).includes(childType);
  });
}

/** The `Child("Room")` string, or null for a workspace-typed node. */
function childTypeOf(node: DomainNode): string | null {
  const entity: unknown = node.entity_type as unknown;
  if (entity && typeof entity === 'object' && 'Child' in entity) {
    return String((entity as { Child: unknown }).Child);
  }
  return null;
}

function descendantsOf(nodes: Record<string, DomainNode>, rootId: string): Set<string> {
  const found: Set<string> = new Set<string>();
  const queue: string[] = [rootId];

  // Bounded by construction, not only by the visited set below.
  //
  // Stored data should never contain a cycle, but a walk that merely *assumes*
  // so turns a data bug into a hung tab — and a hang is the one failure a test
  // cannot catch. A synchronous loop never yields, so the test runner's own
  // timeout never gets to run and the whole suite stops rather than failing.
  // (The same lesson as the sync-loop timeout in round 75.)
  //
  // Every node can be visited at most once, so this many iterations is more
  // than any acyclic tree needs and a cycle cannot outlast it.
  const limit: number = Object.keys(nodes).length + 1;

  for (let step: number = 0; queue.length > 0 && step < limit; step += 1) {
    const current: string | undefined = queue.pop();
    if (current === undefined) continue;
    for (const child of nodes[current]?.children ?? []) {
      if (found.has(child)) continue;
      found.add(child);
      queue.push(child);
    }
  }

  return found;
}
