/**
 * The spaces Settings → Permissions shows: one section per top-level space,
 * holding every space inside it at any depth.
 *
 * Top-level is the sidebar's own rule (`topLevelTrees`), so the two cannot
 * disagree about what exists. The tab's own rule listed only nodes that had
 * children, and so dropped every office without rooms.
 */
import { topLevelTrees } from '@/components/layout/sidebar/tree-node-utils';
import type { DomainNode, TreeNode } from '@/components/layout/sidebar/tree-node-types';
import type { NodeEntityType } from '@/lib/entity-type-registry';

export interface PermissionNode {
  id: string;
  name: string;
  entityType: NodeEntityType;
}

export interface PermissionSection extends PermissionNode {
  children: PermissionNode[];
}

function entry(node: DomainNode): PermissionNode {
  return { id: node.id, name: node.name, entityType: node.entity_type as NodeEntityType };
}

function descendants(tree: TreeNode): PermissionNode[] {
  return tree.children.flatMap((child: TreeNode): PermissionNode[] => [entry(child.node), ...descendants(child)]);
}

export function permissionSections(nodes: readonly DomainNode[]): PermissionSection[] {
  return topLevelTrees(nodes).map((tree: TreeNode): PermissionSection => ({ ...entry(tree.node), children: descendants(tree) }));
}
