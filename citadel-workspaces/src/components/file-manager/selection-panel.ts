/**
 * One selected item opens the inspector; two or more swap it for the bulk bar.
 */
import type { RevfsNode } from '@/types/revfs-types';
import { findNodeByPath } from '@/lib/revfs/tree-operations';

export type SelectionPanel =
  | { kind: 'none' }
  | { kind: 'inspector'; node: RevfsNode }
  | { kind: 'bulk'; nodes: RevfsNode[] };

export function selectionPanel(tree: RevfsNode | null, selected: ReadonlySet<string>): SelectionPanel {
  if (tree === null) return { kind: 'none' };
  const nodes: RevfsNode[] = [];
  for (const path of selected) {
    const node: RevfsNode | null = findNodeByPath(tree, path);
    if (node) nodes.push(node);
  }
  if (nodes.length === 0) return { kind: 'none' };
  return nodes.length === 1 ? { kind: 'inspector', node: nodes[0] } : { kind: 'bulk', nodes };
}
