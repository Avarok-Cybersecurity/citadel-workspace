/**
 * What the focused sidebar shows, as a pure function of the selection.
 *
 * Three lists, and no expanded-set state: the path from the workspace down to
 * the selected node's parent (the ancestor stack), the selected node with its
 * siblings, and the selected node's children. Selecting anything re-derives all
 * three, so back/forward and a reload restore the view for free, a moved node's
 * ancestors follow its new `parent_id`, and a deleted selection falls back to
 * the workspace itself.
 *
 * `root` is the real workspace root or the synthetic one (see `workspaceRoot`);
 * it is never a sibling of a space -- the stack is the only place it appears
 * unless it is the selection.
 */
import type { DomainNode } from './tree-node-types';

export interface FocusedView {
  /** Root first, down to the selected node's parent. Empty when the root is selected. */
  ancestors: DomainNode[];
  selected: DomainNode;
  /** The parent's children, sorted; just the root when the root is selected. */
  siblings: DomainNode[];
  /** The selected node's children, sorted. */
  children: DomainNode[];
}

/** Children by parent id, sorted by name. */
export type ChildIndex = ReadonlyMap<string, DomainNode[]>;

const byName = (a: DomainNode, b: DomainNode): number => a.name.localeCompare(b.name);

/**
 * Every node's children, keyed by parent id. A node whose parent is absent --
 * null, or the server's root sentinel when the root itself is not sent -- is a
 * child of `root`, the same rule `buildTreeFromNodes` uses to find roots.
 */
export function childIndex(nodes: Readonly<Record<string, DomainNode>>, root: DomainNode): ChildIndex {
  const index: Map<string, DomainNode[]> = new Map();
  for (const node of Object.values(nodes)) {
    if (node.id === root.id) continue;
    const parentId: string = node.parent_id !== null && nodes[node.parent_id] ? node.parent_id : root.id;
    index.set(parentId, [...(index.get(parentId) ?? []), node]);
  }
  for (const list of index.values()) list.sort(byName);
  return index;
}

/** `node`'s ancestors, root first, excluding the node; empty for the root itself. */
export function ancestorsOf(nodes: Readonly<Record<string, DomainNode>>, node: DomainNode, root: DomainNode): DomainNode[] {
  if (node.id === root.id) return [];
  const chain: DomainNode[] = [];
  // A cycle in parent_id is malformed data, not a reason to hang the sidebar.
  const seen: Set<string> = new Set([node.id]);
  let current: DomainNode | undefined = node.parent_id !== null ? nodes[node.parent_id] : undefined;
  while (current && current.id !== root.id && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parent_id !== null ? nodes[current.parent_id] : undefined;
  }
  return [root, ...chain];
}

export interface FocusedViewInput {
  nodes: Readonly<Record<string, DomainNode>>;
  children: ChildIndex;
  /** The URL's nodeId; null, unknown or the root all mean the workspace itself. */
  selectedId: string | null;
  root: DomainNode;
}

export function focusedView({ nodes, children, selectedId, root }: FocusedViewInput): FocusedView {
  const selected: DomainNode = (selectedId !== null ? nodes[selectedId] : undefined) ?? root;
  const ancestors: DomainNode[] = ancestorsOf(nodes, selected, root);
  const parent: DomainNode | undefined = ancestors[ancestors.length - 1];
  return {
    ancestors,
    selected,
    siblings: parent ? (children.get(parent.id) ?? []) : [root],
    children: children.get(selected.id) ?? [],
  };
}

/** From this many ancestors the stack collapses its middle into one row. */
export const STACK_COLLAPSE_AT: number = 10;
/** Rows a collapsed stack shows, the "⋯ N more" row included. */
export const STACK_VISIBLE_ROWS: number = 7;

export type StackRow =
  | { kind: 'node'; node: DomainNode; /** True depth, 1 for the root. */ level: number }
  | { kind: 'more'; hidden: DomainNode[] };

/**
 * The ancestor stack as rows. A deep path on a short sidebar keeps the root and
 * the nearest ancestors -- the ones you climb to -- and folds the rest into a
 * row that expands on demand.
 */
export function stackRows(ancestors: DomainNode[], expanded: boolean): StackRow[] {
  const rows: StackRow[] = ancestors.map((node: DomainNode, i: number): StackRow => ({ kind: 'node', node, level: i + 1 }));
  if (expanded || ancestors.length < STACK_COLLAPSE_AT) return rows;
  const tail: number = STACK_VISIBLE_ROWS - 2;
  return [rows[0], { kind: 'more', hidden: ancestors.slice(1, ancestors.length - tail) }, ...rows.slice(ancestors.length - tail)];
}
