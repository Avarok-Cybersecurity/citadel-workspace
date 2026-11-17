/**
 * Which level a new document under a parent would be, from the live schema.
 *
 * A document is a node, so it needs an entity type the schema permits under its parent. Which
 * types those are is the schema's answer, never a name: "Office" and "Room" are the default
 * template's labels and admins rename levels. The default schema has no leaf level (rooms hold
 * rooms), so "the leaf type" does not exist to be assumed; with one permitted type that is the
 * document's level, with several the person chooses, and with none the entry says why not.
 */
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { childTypeChoice, type ChildTypeChoice } from '@/components/layout/sidebar/child-type-choice';
import type { DomainNode, NestingRule, TreeSchema } from '@/components/layout/sidebar/tree-node-types';

export type DocumentPlacement =
  | { kind: 'blocked'; reason: string }
  | { kind: 'one'; type: string }
  | { kind: 'pick'; types: string[] };

/**
 * The types the schema permits under `parentId`, or null while the schema has not arrived.
 *
 * A stored node carries `allowed_child_types`, which the server derives from the live schema on
 * every read. The workspace root is not always stored (the sidebar invents one whose list is
 * merely the types its children happen to have), so for it the schema's Workspace rule is read.
 */
export function childTypesUnder(
  parentId: string,
  nodes: Readonly<Record<string, DomainNode>>,
  schema: TreeSchema | null,
): readonly string[] | null {
  const stored: DomainNode | undefined = nodes[parentId];
  if (stored) return stored.allowed_child_types ?? [];
  if (parentId !== WORKSPACE_ROOT_ID || !schema) return null;
  return schema.rules.find((rule: NestingRule): boolean => rule.parent_type === 'Workspace')?.allowed_child_types ?? [];
}

export function documentPlacement(allowed: readonly string[] | null, parentName: string): DocumentPlacement {
  if (allowed === null) return { kind: 'blocked', reason: 'Waiting for the workspace to finish loading' };
  const choice: ChildTypeChoice = childTypeChoice(allowed);
  if (choice.kind === 'none') return { kind: 'blocked', reason: `Nothing can be added inside ${parentName}` };
  return choice;
}
