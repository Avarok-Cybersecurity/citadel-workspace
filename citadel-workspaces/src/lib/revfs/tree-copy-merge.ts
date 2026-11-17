/**
 * RE-VFS Tree Copy & Merge (Pure Functions)
 *
 * copyNode and mergeTrees — deep-copy and last-write-wins merge.
 */

import {
  type RevfsNode,
  type RevfsOperation,
  RevfsOpType,
  PROTECTED_DIRS,
} from '@/types/revfs-types';
import {
  normalizePath,
  getExtension,
  cloneTree,
  findNode,
  makeOpId,
  now,
  rebasePath,
} from './tree-queries';

// ============================================================================
// Copy Node
// ============================================================================

/**
 * Copy a file or directory to a new location.
 * Creates a deep copy with new timestamps and optional name suffix for collisions.
 */
export function copyNode(
  tree: RevfsNode,
  sourcePath: string,
  destParentPath: string,
  newFileIdGenerator?: () => string,
): [RevfsNode, RevfsOperation] {
  const normalizedSource: string = normalizePath(sourcePath);
  const normalizedDest: string = normalizePath(destParentPath);

  if (normalizedSource === '/') {
    throw new Error('Cannot copy root directory');
  }
  if (PROTECTED_DIRS.has(normalizedSource)) {
    throw new Error(`Cannot copy protected directory: ${normalizedSource}`);
  }

  const newTree: RevfsNode = cloneTree(tree);

  const sourceNode: RevfsNode | null = findNode(newTree, normalizedSource);
  if (!sourceNode) {
    throw new Error(`Source not found: ${normalizedSource}`);
  }

  const destParentNode: RevfsNode | null = findNode(newTree, normalizedDest);
  if (!destParentNode || destParentNode.type !== 'directory') {
    throw new Error(`Destination directory not found: ${normalizedDest}`);
  }

  if (!destParentNode.children) destParentNode.children = [];

  const t: number = now();
  let finalName: string = sourceNode.name;

  const existingNames: Set<string> = new Set(destParentNode.children.map(c => c.name));
  if (existingNames.has(finalName)) {
    const ext: string = sourceNode.type === 'file' ? getExtension(finalName) : '';
    const basePart: string = ext ? finalName.slice(0, -ext.length - 1) : finalName;

    let suffix: number = 1;
    do {
      finalName = suffix === 1
        ? (ext ? `${basePart} (copy).${ext}` : `${basePart} (copy)`)
        : (ext ? `${basePart} (copy ${suffix}).${ext}` : `${basePart} (copy ${suffix})`);
      suffix++;
    } while (existingNames.has(finalName) && suffix < 100);
  }

  const newPath: string = normalizedDest === '/' ? `/${finalName}` : `${normalizedDest}/${finalName}`;

  const copyWithNewPaths = (node: RevfsNode, oldBasePath: string, newBasePath: string): RevfsNode => {
    const copy: RevfsNode = {
      ...node,
      name: node.path === oldBasePath ? finalName : node.name,
      path: rebasePath(node.path, oldBasePath, newBasePath),
      createdAt: t,
      updatedAt: t,
    };

    if (copy.fileMetadata && newFileIdGenerator) {
      // Fresh identity, SHARED bytes. `virtualDirectory` is the upload-time
      // backend key and is deliberately kept: the backend cannot duplicate an
      // object and the browser does not hold the bytes, so both nodes point
      // at one blob. Every delete site refcounts that key via
      // tree-byte-refs.ts and only destroys the blob with its last reference
      // — without that, deleting either copy silently broke the other.
      copy.fileMetadata = {
        ...copy.fileMetadata,
        fileId: newFileIdGenerator(),
      };
    }

    if (node.children) {
      copy.children = node.children.map(child =>
        copyWithNewPaths(child, oldBasePath, newBasePath)
      );
    }

    return copy;
  };

  const copiedNode: RevfsNode = copyWithNewPaths(sourceNode, normalizedSource, newPath);
  destParentNode.children.push(copiedNode);
  destParentNode.updatedAt = t;

  const op: RevfsOperation = {
    op_id: makeOpId(),
    op_type: RevfsOpType.Copy,
    path: normalizedSource,
    destPath: newPath,
    metadata: copiedNode.fileMetadata,
    timestamp: t,
  };

  return [newTree, op];
}

// ============================================================================
// Merge Trees (last-write-wins per path)
// ============================================================================

/**
 * Merge two trees using last-write-wins semantics.
 *
 * Key behaviors:
 * - If both trees have the same path, merge recursively (files use updatedAt)
 * - If remote has a path local doesn't, add it (creation propagates)
 * - If local has a path remote doesn't AND remote.updatedAt > local child's updatedAt,
 *   remove it (deletion propagates)
 */
export function mergeTrees(
  local: RevfsNode,
  remote: RevfsNode,
  /**
   * Paths whose removal is queued locally and not yet applied by the peer.
   *
   * The union rule below is deliberate — deletions are carried by explicit
   * RemoveFile/RemoveDir operations and never inferred, because "never had it"
   * and "deleted it" look identical in a tree. What it lacked was knowledge of
   * what is deliberately on its way out.
   *
   * `removeFile` destroys the bytes, removes the node and QUEUES the op; until
   * the peer applies and acks it, their tree still lists the file. A
   * SyncResponse in that window merged their copy back in, and the restored
   * node names a `virtualDirectory` whose bytes are already gone: a file that
   * reappears in the manager, opens to nothing, and counts against the quota.
   *
   * This says "do not RESURRECT these", not "delete these" — a path we still
   * hold locally stays until its own operation runs.
   */
  pendingRemovals: ReadonlySet<string> = new Set<string>(),
): RevfsNode {
  if (local.type === 'file' && remote.type === 'file') {
    return local.updatedAt >= remote.updatedAt ? cloneTree(local) : cloneTree(remote);
  }

  // Types disagree at this path: one side is a directory, the other a file.
  //
  // This used to be `||`, so a timestamp decided it -- and a newer file
  // arriving at a directory's path replaced the directory AND everything
  // underneath it. The loser there is not a competing version of the same
  // thing; it is every descendant, and nothing records that they existed, so
  // there is no recovering them and no sign anything was lost. A peer a moment
  // behind, or a stale op replayed out of order, is enough.
  //
  // The directory wins, whatever the clocks say. That is the same rule the
  // union merge below already follows: this file's own note says deletions are
  // carried by explicit RemoveFile/RemoveDir operations and never inferred, and
  // a directory disappearing because a file turned up at its path is a deletion
  // nobody asked for.
  if (local.type !== remote.type) {
    return cloneTree(local.type === 'directory' ? local : remote);
  }

  const merged: RevfsNode = cloneTree(local);
  const remoteChildren: RevfsNode[] = remote.children ?? [];
  const localChildren: RevfsNode[] = merged.children ?? [];

  for (const remoteChild of remoteChildren) {
    const localIdx: number = localChildren.findIndex(c => c.path === remoteChild.path);
    if (localIdx >= 0) {
      localChildren[localIdx] = mergeTrees(localChildren[localIdx], remoteChild, pendingRemovals);
    } else if (!pendingRemovals.has(remoteChild.path)) {
      localChildren.push(cloneTree(remoteChild));
    }
  }
  // Note: deletions are handled by explicit RemoveFile/RemoveDir operations,
  // not inferred from missing children.

  merged.children = localChildren;
  merged.updatedAt = Math.max(local.updatedAt, remote.updatedAt);
  return merged;
}
