/**
 * The words the focused tree puts next to a node, all read from the live schema.
 *
 * "Office" and "Room" are the default template's names, and admins rename
 * levels; every label here comes from `getEntityMetadata` for the types the
 * server says a node holds (`allowed_child_types`) or the types its children
 * actually have. Nothing branches on a type's name.
 */
import { getEntityMetadata, getEntityTypeString } from '@/lib/entity-type-registry';
import type { DomainNode } from '../tree-node-types';

/** The labels of the types `node` may hold, in schema order; empty when it may hold none. */
export function childTypeLabels(node: DomainNode): string[] {
  return (node.allowed_child_types ?? []).map((type: string): string => getEntityMetadata(type).label);
}

/** "Add Room", "Add Room or Desk"; null when nothing may be added inside `node`. */
export function addChildLabel(node: DomainNode): string | null {
  const labels: string[] = childTypeLabels(node);
  return labels.length === 0 ? null : `Add ${labels.join(' or ')}`;
}

/** "2 rooms", "1 room"; a bare count when the children are of several types. */
export function childCountLabel(children: readonly DomainNode[]): string {
  const types: Set<string> = new Set(children.map((c: DomainNode): string => getEntityTypeString(c.entity_type)));
  if (types.size !== 1) return String(children.length);
  const meta: ReturnType<typeof getEntityMetadata> = getEntityMetadata([...types][0]);
  return `${children.length} ${(children.length === 1 ? meta.label : meta.pluralLabel).toLowerCase()}`;
}

/** A node's own level, by the schema's name for it: "Workspace", or whatever an admin renamed "Office" to. */
export function levelLabel(node: DomainNode): string {
  return getEntityMetadata(node.entity_type).label;
}

/** The root's caption: its own level's label, e.g. "Workspace". */
export function rootLabel(root: DomainNode): string {
  return levelLabel(root);
}
