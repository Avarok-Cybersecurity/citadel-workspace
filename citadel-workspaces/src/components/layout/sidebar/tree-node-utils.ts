import { isVariant } from 'citadel-workspace-client-ts';
import { getEntityTypeString } from '@/lib/entity-type-registry';
import type { DomainNode, TreeNode } from './tree-node-types';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';

/**
 * Builds a tree structure from a flat list of DomainNodes.
 * Groups nodes by parent_id and creates a recursive TreeNode structure.
 */
/**
 * `rootName` names the synthetic parent made when there are several top-level spaces:
 * the workspace's own name. It said "Workspace", measured live.
 */
export function buildTreeFromNodes(nodes: DomainNode[], rootName: string): TreeNode | null {
  if (nodes.length === 0) return null;

  // Build lookup maps
  const nodeMap: Map<string, DomainNode> = new Map<string, DomainNode>();
  const childrenMap: Map<string | null, DomainNode[]> = new Map<string | null, DomainNode[]>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    const parentId: string | null = node.parent_id;
    const siblings: DomainNode[] = childrenMap.get(parentId) ?? [];
    siblings.push(node);
    childrenMap.set(parentId, siblings);
  }

  // A root is a node whose parent is not in this set.
  //
  // This used to be "children of null" PLUS "children of 'workspace-root'",
  // which double-counts whenever the server includes the workspace root node
  // itself: the root has parent_id null so it is a root, and its children name
  // 'workspace-root' as their parent so they were treated as roots too. Every
  // top-level office then rendered TWICE — once beside the root and once
  // beneath it — with duplicate ids and duplicate data-testids, which is how
  // this surfaced (a testid lookup resolving to 2 elements).
  //
  // Deriving it from the data answers both cases with one rule: when the root
  // node is present its children have a resolvable parent and are not roots;
  // when it is absent they have a dangling 'workspace-root' parent and are.
  const roots: DomainNode[] = nodes.filter(
    (node) => node.parent_id === null || !nodeMap.has(node.parent_id)
  );
  if (roots.length === 0) return null;

  // Sort roots by name
  roots.sort((a, b) => a.name.localeCompare(b.name));

  // Recursive function to build tree
  function buildNode(node: DomainNode): TreeNode {
    const nodeChildren: DomainNode[] = childrenMap.get(node.id) ?? [];
    // Sort children by name
    nodeChildren.sort((a, b) => a.name.localeCompare(b.name));

    return {
      node,
      children: nodeChildren.map(buildNode),
    };
  }

  // Single root: return it directly
  if (roots.length === 1) {
    return buildNode(roots[0]);
  }

  // Multiple roots: wrap in synthetic workspace node so all are visible
  const syntheticRoot: DomainNode = syntheticWorkspaceRoot(roots, rootName);

  return {
    node: syntheticRoot,
    children: roots.map(buildNode),
  };
}

/**
 * The workspace root the client stands in for when the server sends none.
 *
 * WORKSPACE_ROOT_ID is a sentinel on the server, never a stored node, so the
 * row that represents the workspace is invented here: named after it, holding
 * `roots`, offering their types as its children.
 */
export function syntheticWorkspaceRoot(roots: DomainNode[], rootName: string): DomainNode {
  return {
    id: WORKSPACE_ROOT_ID,
    parent_id: null,
    entity_type: 'Workspace',
    depth: 0,
    name: rootName,
    description: '',
    owner_id: '',
    members: [],
    children: roots.map(r => r.id),
    mdx_content: '',
    // A synthetic root the client invents to hold the real roots; it has no
    // stored document and therefore no server hash.
    mdx_content_hash: null,
    rules: null,
    chat_enabled: false,
    chat_channel_id: null,
    default_permissions: roots[0].default_permissions,
    metadata: [],
    allowed_child_types: [...new Set(roots.map(r =>
      isVariant(r.entity_type as Record<string, unknown>, 'Child') ? (r.entity_type as { Child: string }).Child :
      getEntityTypeString(r.entity_type)
    ))],
    is_default: false,
    created_at: 0n,
    updated_at: 0n,
  };
}

/**
 * The node the sidebar promotes as the workspace: the real root when the server
 * sent one, otherwise a synthetic one -- even over a SINGLE top-level space,
 * which `buildTreeFromNodes` returns bare. That space is an office, not the
 * workspace, and labelling it WORKSPACE would make it a peer of nothing.
 */
export function workspaceRoot(nodes: DomainNode[], rootName: string): DomainNode | null {
  const tree: TreeNode | null = buildTreeFromNodes(nodes, rootName);
  if (!tree) return null;
  const isWorkspace: boolean = tree.node.id === WORKSPACE_ROOT_ID || tree.node.entity_type === 'Workspace';
  return isWorkspace ? tree.node : syntheticWorkspaceRoot([tree.node], rootName);
}

/**
 * The spaces directly under the workspace, each with its subtree -- the sidebar's rule.
 *
 * `buildTreeFromNodes` returns the workspace root (real, or the synthetic one it
 * makes for several top-level spaces) with the spaces beneath it, or a single
 * space on its own; both read here as the list of top-level spaces.
 */
export function topLevelTrees(nodes: readonly DomainNode[]): TreeNode[] {
  const tree: TreeNode | null = buildTreeFromNodes([...nodes], '');
  if (!tree) return [];
  return tree.node.id === WORKSPACE_ROOT_ID ? tree.children : [tree];
}

/**
 * How many spaces sit inside `nodeId`, at any depth, by `parent_id` -- the relation the
 * tree is drawn from. A node's own `children` list can lag it: after a room was moved in,
 * deleting its new office warned about nothing (measured live).
 */
export function descendantCount(nodes: readonly DomainNode[], nodeId: string): number {
  const byParent: Map<string, string[]> = new Map();
  for (const node of nodes) {
    if (node.parent_id === null) continue;
    byParent.set(node.parent_id, [...(byParent.get(node.parent_id) ?? []), node.id]);
  }
  let count: number = 0;
  const pending: string[] = [...(byParent.get(nodeId) ?? [])];
  while (pending.length > 0) {
    const next: string = pending.pop() as string;
    count++;
    pending.push(...(byParent.get(next) ?? []));
  }
  return count;
}

/** The ids of `nodeId`'s ancestors, nearest first; a cycle in the parents stops at its first repeat. */
export function ancestorIdsOf(nodes: Readonly<Record<string, DomainNode>>, nodeId: string): string[] {
  const out: string[] = [];
  let at: string | null = nodes[nodeId]?.parent_id ?? null;
  while (at !== null && !out.includes(at)) {
    out.push(at);
    at = nodes[at]?.parent_id ?? null;
  }
  return out;
}
