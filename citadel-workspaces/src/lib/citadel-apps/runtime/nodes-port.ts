/**
 * `nodes.read` for a first-party glue app (Calendar design C3): NodeGet and NodeChildren answered
 * from the tree this page already holds, which is the tree the signed-in member may see. No
 * request crosses to the server, so the install's reach is enforced here, as the kernel's
 * `target_of` does for storage (apps_call.rs): a `Node` install sees its node, a `NodeTree`
 * install its subtree, any other scope the whole tree. A node outside either is `not_found`, the
 * same answer as a node that does not exist, so the reply says nothing about what lies beyond.
 *
 * A page's text (NodeReadMdx) and `nodes.write` are not offered to glue apps: those four ops
 * refuse `unavailable`.
 */
import type { InstallScope } from 'citadel-workspace-client-ts';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import type { NodeInfo } from '../sdk/generated/NodeInfo';
import type { NodesPort, PortAnswer } from '../host/ports';

/** The parts of a page's node that NodeGet reports. */
export interface PageNode {
  readonly id: string;
  readonly name: string;
  readonly parent_id: string | null;
  readonly children: readonly string[];
}

/** The page's tree as it stands now (read per call, so a rename is seen at once). */
export type TreeRead = () => Readonly<Record<string, PageNode>>;

/**
 * The page's tree with the workspace in it. `WORKSPACE_ROOT_ID` is a sentinel on the server, never a
 * stored node, so the tree the page holds never contains it, and a Calendar on the workspace's own
 * page was refused `not_found` for the node it runs on. The kernel answers the sentinel (get_node,
 * list_nodes) with the spaces whose parent is none or the sentinel as its children; so does this.
 */
export function withWorkspaceRoot(nodes: Readonly<Record<string, PageNode>>, name: string): Readonly<Record<string, PageNode>> {
  if (nodes[WORKSPACE_ROOT_ID] !== undefined) return nodes;
  const children: string[] = Object.values(nodes).filter((n: PageNode) => n.parent_id === null || n.parent_id === WORKSPACE_ROOT_ID).map((n: PageNode) => n.id);
  return { ...nodes, [WORKSPACE_ROOT_ID]: { id: WORKSPACE_ROOT_ID, name, parent_id: null, children } };
}

const NOT_FOUND: PortAnswer<never> = { refused: { unavailable: 'not_found' } };
const READ_ONLY: PortAnswer<never> = { refused: { unavailable: 'nodes' } };

function subtreeOf(nodes: Readonly<Record<string, PageNode>>, root: string): ReadonlySet<string> {
  const seen: Set<string> = new Set();
  const queue: string[] = [root];
  while (queue.length > 0) {
    const id: string = queue.shift() as string;
    const node: PageNode | undefined = nodes[id];
    if (node === undefined || seen.has(id)) continue;
    seen.add(id);
    queue.push(...node.children);
  }
  return seen;
}

/** Whether `scope` reaches `nodeId` in `nodes`. */
export function reaches(scope: InstallScope, nodes: Readonly<Record<string, PageNode>>, nodeId: string): boolean {
  if (typeof scope === 'object' && 'Node' in scope) return scope.Node === nodeId;
  if (typeof scope === 'object' && 'NodeTree' in scope) return subtreeOf(nodes, scope.NodeTree).has(nodeId);
  return true;
}

function info(nodes: Readonly<Record<string, PageNode>>, node: PageNode): NodeInfo {
  return { node_id: node.id, name: node.name, parent_id: node.parent_id, has_children: node.children.some((c: string) => nodes[c] !== undefined) };
}

export function treeNodesPort(scope: InstallScope, read: TreeRead): NodesPort {
  const visible = (id: string): { nodes: Readonly<Record<string, PageNode>>; node: PageNode } | null => {
    const nodes: Readonly<Record<string, PageNode>> = read();
    const node: PageNode | undefined = nodes[id];
    return node === undefined || !reaches(scope, nodes, id) ? null : { nodes, node };
  };
  return {
    NodeGet: ({ node_id }): ReturnType<NodesPort['NodeGet']> => {
      const at: { nodes: Readonly<Record<string, PageNode>>; node: PageNode; } | null = visible(node_id);
      return at === null ? NOT_FOUND : { ok: info(at.nodes, at.node) };
    },
    NodeChildren: ({ node_id }): ReturnType<NodesPort['NodeChildren']> => {
      const at: { nodes: Readonly<Record<string, PageNode>>; node: PageNode; } | null = visible(node_id);
      if (at === null) return NOT_FOUND;
      const children: NodeInfo[] = [];
      for (const id of at.node.children) {
        const child: PageNode | undefined = at.nodes[id];
        if (child !== undefined && reaches(scope, at.nodes, id)) children.push(info(at.nodes, child));
      }
      return { ok: { nodes: children } };
    },
    NodeReadMdx: () => READ_ONLY,
    NodeCreate: () => READ_ONLY,
    NodeRename: () => READ_ONLY,
    NodeMove: () => READ_ONLY,
  };
}
