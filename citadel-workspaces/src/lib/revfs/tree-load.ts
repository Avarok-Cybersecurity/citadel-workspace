/**
 * Reading a tree from disk: what a reload shows.
 *
 * Moved out of RevfsService when it grew two more questions than the service
 * had room for. The outcomes, and why each matters:
 *
 *   - loaded: seen from THIS account (see `asSeenBy`), cached, marked read.
 *   - absent, with a tree under the pre-directional shared key: adopted,
 *     written under this account's own key, and the shared one left alone.
 *   - genuinely absent: a default, persisted, marked read.
 *   - unreadable: an error. It returned an empty default "for the caller to
 *     render", which is the screen a user reads as "my files are gone" — and a
 *     default that is not marked read makes every write of the session a
 *     refused one, so the session's own work evaporated at the next reload.
 */
import { RevfsFileState, type RevfsNode, type TreeKey } from '@/types/revfs-types';
import type { RevfsIntentResult } from '@/types/revfs-intents';
import type { RevfsIO } from './revfs-io';
import type { RevfsState } from './revfs-state';
import { createDefaultTree } from './tree-queries';
import { persistTree, markTreeRead } from './persist-tree';

export class RevfsTreeUnreadableError extends Error {
  constructor(key: TreeKey) {
    super(`This browser could not read its saved file list (${key}). Nothing was changed; try again.`);
    this.name = 'RevfsTreeUnreadableError';
  }
}

export interface TreeLoadRequest {
  key: TreeKey;
  /** The account reading, for peer trees; null for server trees. */
  viewer: bigint | null;
  /** A shared pre-directional key to adopt from, or null when there is none. */
  legacyKey: TreeKey | null;
}

/**
 * A peer tree's Remote/Hosted states as `viewer` sees them.
 *
 * The rule `placeFile` applies: the uploader's copy is Remote (the peer holds
 * the bytes for me), everyone else's is Hosted. A tree adopted from the shared
 * key, or written there by the other account, carries the other side's view —
 * which read as "0 B used" for a file the viewer uploaded.
 */
export function asSeenBy(node: RevfsNode, viewer: bigint): RevfsNode {
  const seen: RevfsNode = { ...node };
  const state: RevfsFileState | undefined = node.fileState;
  const uploader: bigint | undefined = node.fileMetadata?.uploadedByCid;
  if ((state === RevfsFileState.Remote || state === RevfsFileState.Hosted) && uploader !== undefined) {
    seen.fileState = uploader === viewer ? RevfsFileState.Remote : RevfsFileState.Hosted;
  }
  if (node.children) seen.children = node.children.map((c: RevfsNode): RevfsNode => asSeenBy(c, viewer));
  return seen;
}

async function read(io: RevfsIO, key: TreeKey): Promise<RevfsNode | null> {
  const result: RevfsIntentResult = await io.execute({ type: 'load-tree', treeKey: key });
  if (result.type !== 'load-tree' || result.unreadable) throw new RevfsTreeUnreadableError(key);
  return result.tree;
}

export async function loadTree(state: RevfsState, io: RevfsIO, req: TreeLoadRequest): Promise<RevfsNode> {
  const cached: RevfsNode | undefined = state.getTree(req.key);
  if (cached) return cached;

  const own: RevfsNode | null = await read(io, req.key);
  const adopted: RevfsNode | null = own === null && req.legacyKey !== null ? await read(io, req.legacyKey) : null;

  // An op that landed while the read was in flight has already written through
  // `setTree`; anything below would be written straight over it.
  const appliedDuringLoad: RevfsNode | undefined = state.getTree(req.key);
  if (appliedDuringLoad) return appliedDuringLoad;

  const found: RevfsNode | null = own ?? adopted;
  const tree: RevfsNode = found === null
    ? createDefaultTree()
    : req.viewer === null ? found : asSeenBy(found, req.viewer);
  markTreeRead(req.key);
  state.setTree(req.key, tree);
  if (own === null) await persistTree(io, req.key, tree);
  return tree;
}
