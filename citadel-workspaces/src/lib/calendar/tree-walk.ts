/**
 * The tree around a node, as the Calendar's propagation needs it (design 3.5), read through the
 * `nodes.read` port: the node's chain (itself, then each ancestor to the root), which an up-pull
 * matches `up_to` against, and its descendants breadth-first, which a fan-out writes into and an
 * up-pull reads from. A walk stops one node past its bound, so the caller (the core) can tell a
 * subtree of exactly the bound from a larger one; the bound is the core's, never one of ours.
 */
import type { NodeInfo } from '@/lib/citadel-apps/sdk/generated/NodeInfo';
import { PortRefused, type CalendarPorts } from './ports';

type TreePorts = Pick<CalendarPorts, 'node' | 'children'>;

/** Whether a NodeGet refusal means "not a node this install sees", which ends a chain. */
function outOfSight(error: unknown): boolean {
  return error instanceof PortRefused && typeof error.refused === 'object' && 'unavailable' in error.refused && error.refused.unavailable === 'not_found';
}

/**
 * `node`, then each ancestor this install can see, to the root. A parent the install does not see
 * (outside its scope) ends the chain there; a cycle in the tree is refused rather than walked.
 */
export async function chainOf(ports: TreePorts, node: string): Promise<string[]> {
  const chain: string[] = [];
  let at: string | null = node;
  while (at !== null) {
    if (chain.includes(at)) throw new Error(`the tree loops back to ${at}`);
    let info: NodeInfo;
    try {
      info = await ports.node(at);
    } catch (error: unknown) {
      if (chain.length > 0 && outOfSight(error)) return chain;
      throw error;
    }
    chain.push(info.node_id);
    at = info.parent_id;
  }
  return chain;
}

/** `node`'s descendants (not `node`), breadth-first, at most `bound + 1` of them. */
export async function descendantsOf(ports: TreePorts, node: string, bound: number): Promise<string[]> {
  const found: string[] = [];
  const seen: Set<string> = new Set([node]);
  const queue: string[] = [node];
  while (queue.length > 0 && found.length <= bound) {
    const parent: string = queue.shift() as string;
    for (const child of await ports.children(parent)) {
      if (seen.has(child.node_id)) continue;
      seen.add(child.node_id);
      found.push(child.node_id);
      if (found.length > bound) return found;
      if (child.has_children) queue.push(child.node_id);
    }
  }
  return found;
}
