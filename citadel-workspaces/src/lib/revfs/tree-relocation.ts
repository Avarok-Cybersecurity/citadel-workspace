/**
 * Relocating a node: Move and Copy.
 *
 * The two structural relocations, kept together because they ask the same
 * questions in the same order — is the path protected, does the source exist,
 * does the destination's parent exist and is it a directory, is the destination
 * name already taken — and every one of those is a REFUSAL the sender has to
 * hear about rather than a silent no-op.
 *
 * Split from `tree-sync` when that file outgrew its ceiling. Keeping the pair
 * adjacent is what stops one of them gaining a check the other never gets, which
 * is the defect class this campaign has found most often.
 */
import {
  type RevfsNode,
  type RevfsOperation,
  RevfsOpType,
  PROTECTED_DIRS,
} from '@/types/revfs-types';
import { parentPath, baseName, findNode, rebasePath } from './tree-queries';
import { applied, refused, type RemoteOpOutcome } from './remote-op-outcome';

/** Rewrite a subtree's paths in place after its root moved. */
function rebaseInPlace(node: RevfsNode, from: string, to: string, timestamp: number): void {
  node.path = rebasePath(node.path, from, to);
  node.updatedAt = timestamp;
  for (const child of node.children ?? []) rebaseInPlace(child, from, to, timestamp);
}

/** A deep copy of a subtree, rooted at a new path. */
function copyWithNewPaths(
  node: RevfsNode,
  from: string,
  to: string,
  op: RevfsOperation,
  destName: string,
): RevfsNode {
  const copy: RevfsNode = {
    ...node,
    name: node.path === from ? destName : node.name,
    path: rebasePath(node.path, from, to),
    createdAt: op.timestamp,
    updatedAt: op.timestamp,
  };
  if (node.path === from && op.metadata) copy.fileMetadata = op.metadata;
  if (node.children) {
    copy.children = node.children.map((child) => copyWithNewPaths(child, from, to, op, destName));
  }
  return copy;
}

/**
 * Apply a Move or Copy, or return `null` when the operation is neither — so the
 * caller falls through to its own switch.
 */
export function applyRelocation(newTree: RevfsNode, op: RevfsOperation): RemoteOpOutcome | null {
  if (op.op_type !== RevfsOpType.Move && op.op_type !== RevfsOpType.Copy) return null;
  if (!op.destPath) return refused(newTree);
  if (PROTECTED_DIRS.has(op.path)) return refused(newTree);

  const destParentNode: RevfsNode | null = findNode(newTree, parentPath(op.destPath));
  if (!destParentNode || destParentNode.type !== 'directory') return refused(newTree);
  if (!destParentNode.children) destParentNode.children = [];

  const destName: string = baseName(op.destPath);
  if (destParentNode.children.some((c) => c.name === destName)) return refused(newTree);

  if (op.op_type === RevfsOpType.Move) {
    const sourceParentNode: RevfsNode | null = findNode(newTree, parentPath(op.path));
    if (!sourceParentNode?.children) return refused(newTree);
    const sourceIdx: number = sourceParentNode.children.findIndex((c) => c.path === op.path);
    if (sourceIdx < 0) return refused(newTree);

    const [movedNode] = sourceParentNode.children.splice(sourceIdx, 1);
    sourceParentNode.updatedAt = op.timestamp;
    rebaseInPlace(movedNode, op.path, op.destPath, op.timestamp);
    destParentNode.children.push(movedNode);
    destParentNode.updatedAt = op.timestamp;
    return applied(newTree);
  }

  const sourceNode: RevfsNode | null = findNode(newTree, op.path);
  if (!sourceNode) return refused(newTree);
  destParentNode.children.push(copyWithNewPaths(sourceNode, op.path, op.destPath, op, destName));
  destParentNode.updatedAt = op.timestamp;
  return applied(newTree);
}
