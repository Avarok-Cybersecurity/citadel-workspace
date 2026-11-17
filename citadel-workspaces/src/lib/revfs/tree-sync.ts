/**
 * RE-VFS Tree Sync (Pure Functions)
 *
 * Applies remote operations to local trees — used for peer synchronization.
 */

import {
  type RevfsNode,
  type RevfsOperation,
  RevfsFileState,
  RevfsOpType,
  PROTECTED_DIRS,
} from '@/types/revfs-types';
import {
  parentPath,
  baseName,
  cloneTree,
  findNode,
  rebasePath,
} from './tree-queries';
import { flipNodeStates } from './file-states';
import { applied, refused, type RemoteOpOutcome } from './remote-op-outcome';
import { applyRelocation } from './tree-relocation';

// ============================================================================
// Apply Remote Operation
// ============================================================================

export function applyRemoteOpWithOutcome(
  tree: RevfsNode,
  op: RevfsOperation,
  _viewerCid: bigint,
): RemoteOpOutcome {
  const newTree: RevfsNode = cloneTree(tree);

  // Move and Copy live in tree-relocation.ts; see its header for why the pair
  // is kept together.
  const relocated: RemoteOpOutcome | null = applyRelocation(newTree, op);
  if (relocated) return relocated;

  switch (op.op_type) {
    case RevfsOpType.Mkdir: {
      const parent: string = parentPath(op.path);
      const name: string = baseName(op.path);
      const parentNode: RevfsNode | null = findNode(newTree, parent);
      if (!parentNode || parentNode.type !== 'directory') return refused(newTree);
      // Idempotent: the directory it asked for is already there, so the
      // intended end state holds and the sender may retire the op.
      if (findNode(newTree, op.path)) return applied(newTree);
      if (!parentNode.children) parentNode.children = [];
      parentNode.children.push({
        name,
        type: 'directory',
        path: op.path,
        children: [],
        createdAt: op.timestamp,
        updatedAt: op.timestamp,
      });
      parentNode.updatedAt = op.timestamp;
      break;
    }

    case RevfsOpType.Rmdir: {
      if (PROTECTED_DIRS.has(op.path)) return refused(newTree);
      const parent: string = parentPath(op.path);
      const parentNode: RevfsNode | null = findNode(newTree, parent);
      if (!parentNode?.children) return refused(newTree);
      const idx: number = parentNode.children.findIndex(c => c.path === op.path);
      if (idx >= 0) {
        parentNode.children.splice(idx, 1);
        parentNode.updatedAt = op.timestamp;
      }
      break;
    }

    case RevfsOpType.PlaceFile: {
      if (!op.metadata) return refused(newTree);
      const parent: string = parentPath(op.path);
      const name: string = baseName(op.path);
      const parentNode: RevfsNode | null = findNode(newTree, parent);
      if (!parentNode || parentNode.type !== 'directory') return refused(newTree);
      if (!parentNode.children) parentNode.children = [];

      // Same inversion as tree-mutations.ts `placeFile` — see the note there.
      // Whoever uploaded holds the decryptable copy's address (Remote); whoever
      // received the bytes is the one hosting them.
      const fileState: RevfsFileState = op.metadata.uploadedByCid === _viewerCid
        ? RevfsFileState.Remote
        : RevfsFileState.Hosted;

      const fileNode: RevfsNode = {
        name,
        type: 'file',
        path: op.path,
        fileState,
        fileMetadata: op.metadata,
        createdAt: op.timestamp,
        updatedAt: op.timestamp,
      };

      const existingIdx: number = parentNode.children.findIndex(c => c.path === op.path);
      if (existingIdx >= 0) {
        parentNode.children[existingIdx] = fileNode;
      } else {
        parentNode.children.push(fileNode);
      }
      parentNode.updatedAt = op.timestamp;
      break;
    }

    case RevfsOpType.RemoveFile: {
      const parent: string = parentPath(op.path);
      const parentNode: RevfsNode | null = findNode(newTree, parent);
      if (!parentNode?.children) return refused(newTree);
      const idx: number = parentNode.children.findIndex(c => c.path === op.path);
      if (idx >= 0) {
        parentNode.children.splice(idx, 1);
        parentNode.updatedAt = op.timestamp;
      }
      break;
    }

    case RevfsOpType.SyncResponse: {
      if (op.tree) {
        return applied(flipNodeStates(cloneTree(op.tree)));
      }
      break;
    }

    case RevfsOpType.Rename: {
      if (!op.newName) return refused(newTree);
      if (PROTECTED_DIRS.has(op.path)) return refused(newTree);

      const parent: string = parentPath(op.path);
      const parentNode: RevfsNode | null = findNode(newTree, parent);
      if (!parentNode?.children) return refused(newTree);

      const idx: number = parentNode.children.findIndex(c => c.path === op.path);
      if (idx < 0) return refused(newTree);

      const node: RevfsNode = parentNode.children[idx];
      const newPath: string = parent === '/' ? `/${op.newName}` : `${parent}/${op.newName}`;

      if (parentNode.children.some(c => c.path === newPath)) return refused(newTree);

      const updatePaths = (n: RevfsNode, oldBasePath: string, newBasePath: string): void => {
        n.path = rebasePath(n.path, oldBasePath, newBasePath);
        n.updatedAt = op.timestamp;
        if (n.children) {
          for (const child of n.children) {
            updatePaths(child, oldBasePath, newBasePath);
          }
        }
      };

      node.name = op.newName;
      updatePaths(node, op.path, newPath);
      parentNode.updatedAt = op.timestamp;
      break;
    }

    default:
      break;
  }

  return applied(newTree);
}

/**
 * The tree alone, for callers that do not act on whether it applied.
 *
 * The merge path is one: a SyncResponse folds the peer's whole tree in, and a
 * single refused operation inside that is not something to acknowledge either
 * way.
 */
export function applyRemoteOp(
  tree: RevfsNode,
  op: RevfsOperation,
  viewerCid: bigint,
): RevfsNode {
  return applyRemoteOpWithOutcome(tree, op, viewerCid).tree;
}
