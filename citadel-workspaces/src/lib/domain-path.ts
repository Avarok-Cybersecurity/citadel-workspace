/**
 * The path from the workspace down to one node: the one answer to "where is this?".
 *
 * Used where a node is placed among its ancestors -- the permission editor's
 * path (where a grant comes from) and the header's breadcrumbs (where you are).
 * Moved here from the permission editor so both read the same path, rather
 * than the breadcrumbs walking the tree a second way.
 *
 * Level names come from the live schema (`levelLabel`); nothing branches on
 * "Office" or "Room", which are only the default template's words.
 *
 * Pure: the nodes are the caller's.
 */
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';
import { workspaceRoot } from '@/components/layout/sidebar/tree-node-utils';
import { ancestorsOf } from '@/components/layout/sidebar/focused-view';
import { levelLabel } from '@/components/layout/sidebar/FocusedTree/level-labels';
import { getEntityMetadata } from '@/lib/entity-type-registry';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';

/** One level on the path: its id, its own name, and the schema's name for its kind. */
export interface DomainLevel {
  id: string;
  name: string;
  kind: string;
}

/** What an unknown level is called: the tree has not sent it, so there is no name to show. */
export const UNLISTED_LEVEL: string = 'a level not yet loaded';

const asLevel = (node: DomainNode): DomainLevel => ({ id: node.id, name: node.name, kind: levelLabel(node) });

/**
 * The workspace first, down to `domainId`; the root itself is the workspace on
 * its own. A domain the tree does not hold stays the last level -- under the
 * workspace, unnamed -- rather than quietly becoming the workspace.
 */
export function domainPath(
  nodes: Readonly<Record<string, DomainNode>>,
  domainId: string,
  workspaceName: string,
): DomainLevel[] {
  const root: DomainNode | null = workspaceRoot(Object.values(nodes), workspaceName);
  const workspace: DomainLevel = root
    ? asLevel(root)
    : { id: WORKSPACE_ROOT_ID, name: workspaceName, kind: getEntityMetadata('Workspace').label };
  const node: DomainNode | undefined = nodes[domainId];
  // The id asked about is the id returned, whichever of the two names the workspace.
  if (domainId === WORKSPACE_ROOT_ID || domainId === workspace.id) return [{ ...workspace, id: domainId }];
  if (!root || !node) return [workspace, { id: domainId, name: UNLISTED_LEVEL, kind: '' }];
  return [workspace, ...ancestorsOf(nodes, node, root).slice(1).map(asLevel), asLevel(node)];
}
