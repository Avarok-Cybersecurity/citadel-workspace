/**
 * RE-VFS Tree Mutations (Pure Functions)
 *
 * mkdir, rmdir, placeFile, removeFile — each returns a new tree + RevfsOperation.
 */

import {
  type RevfsNode,
  type RevfsFileMetadata,
  type RevfsOperation,
  RevfsFileState,
  RevfsOpType,
  PROTECTED_DIRS,
} from '@/types/revfs-types';
import {
  normalizePath,
  parentPath,
  baseName,
  cloneTree,
  findNode,
  makeOpId,
  now,
} from './tree-queries';

// ============================================================================
// Mkdir
// ============================================================================

export function mkdir(tree: RevfsNode, path: string): [RevfsNode, RevfsOperation] {
  const normalized: string = normalizePath(path);
  const parent: string = parentPath(normalized);
  const name: string = baseName(normalized);

  const newTree: RevfsNode = cloneTree(tree);
  const parentNode: RevfsNode | null = findNode(newTree, parent);
  if (!parentNode || parentNode.type !== 'directory') {
    throw new Error(`Parent directory not found: ${parent}`);
  }
  if (findNode(newTree, normalized)) {
    throw new Error(`Directory already exists: ${normalized}`);
  }

  const t: number = now();
  const child: RevfsNode = {
    name,
    type: 'directory',
    path: normalized,
    children: [],
    createdAt: t,
    updatedAt: t,
  };

  if (!parentNode.children) parentNode.children = [];
  parentNode.children.push(child);
  parentNode.updatedAt = t;

  const op: RevfsOperation = {
    op_id: makeOpId(),
    op_type: RevfsOpType.Mkdir,
    path: normalized,
    timestamp: t,
  };

  return [newTree, op];
}

// ============================================================================
// Rmdir
// ============================================================================

export function rmdir(tree: RevfsNode, path: string): [RevfsNode, RevfsOperation] {
  const normalized: string = normalizePath(path);

  if (PROTECTED_DIRS.has(normalized)) {
    throw new Error(`Cannot remove protected directory: ${normalized}`);
  }
  if (normalized === '/') {
    throw new Error('Cannot remove root directory');
  }

  const parent: string = parentPath(normalized);
  const newTree: RevfsNode = cloneTree(tree);
  const parentNode: RevfsNode | null = findNode(newTree, parent);
  if (!parentNode || !parentNode.children) {
    throw new Error(`Parent directory not found: ${parent}`);
  }

  const idx: number = parentNode.children.findIndex(c => c.path === normalized);
  if (idx < 0) {
    throw new Error(`Directory not found: ${normalized}`);
  }
  if (parentNode.children[idx].type !== 'directory') {
    throw new Error(`Not a directory: ${normalized}`);
  }

  parentNode.children.splice(idx, 1);
  parentNode.updatedAt = now();

  const op: RevfsOperation = {
    op_id: makeOpId(),
    op_type: RevfsOpType.Rmdir,
    path: normalized,
    timestamp: now(),
  };

  return [newTree, op];
}

// ============================================================================
// Place File
// ============================================================================

export function placeFile(
  tree: RevfsNode,
  path: string,
  metadata: RevfsFileMetadata,
  viewerCid: bigint,
): [RevfsNode, RevfsOperation] {
  const normalized: string = normalizePath(path);
  const parent: string = parentPath(normalized);
  const name: string = baseName(normalized);

  const newTree: RevfsNode = cloneTree(tree);
  const parentNode: RevfsNode | null = findNode(newTree, parent);
  if (!parentNode || parentNode.type !== 'directory') {
    throw new Error(`Parent directory not found: ${parent}`);
  }

  // This was inverted, against the enum's own documentation.
  //
  // `uploadFileToPeer` sends the BYTES to the peer (`backend-send-file` with
  // that peer's cid), so after an upload it is the PEER who stores the encrypted
  // blob. RevfsFileState says exactly that: Remote = "peer stores the encrypted
  // blob for me (downloadable)", Hosted = "I store it for the peer (can't
  // decrypt)". Stamping the uploader Hosted made a user's own file permanently
  // un-downloadable — the download handler excludes Hosted — and told them it
  // was "Hosted for peer (encrypted, cannot open)" about a file only they could
  // open. The peer, meanwhile, was stamped Remote and pulled from the uploader's
  // node, where nothing was ever stored. The file was retrievable by nobody.
  const fileState: RevfsFileState = metadata.uploadedByCid === viewerCid
    ? RevfsFileState.Remote
    : RevfsFileState.Hosted;

  const t: number = now();
  const fileNode: RevfsNode = {
    name,
    type: 'file',
    path: normalized,
    fileState,
    fileMetadata: metadata,
    createdAt: t,
    updatedAt: t,
  };

  if (!parentNode.children) parentNode.children = [];

  // Replace existing file at same path if present
  const existingIdx: number = parentNode.children.findIndex(c => c.path === normalized);
  if (existingIdx >= 0) {
    parentNode.children[existingIdx] = fileNode;
  } else {
    parentNode.children.push(fileNode);
  }
  parentNode.updatedAt = t;

  const op: RevfsOperation = {
    op_id: makeOpId(),
    op_type: RevfsOpType.PlaceFile,
    path: normalized,
    metadata,
    timestamp: t,
  };

  return [newTree, op];
}

// ============================================================================
// Remove File
// ============================================================================

export function removeFile(tree: RevfsNode, path: string): [RevfsNode, RevfsOperation] {
  const normalized: string = normalizePath(path);
  const parent: string = parentPath(normalized);

  const newTree: RevfsNode = cloneTree(tree);
  const parentNode: RevfsNode | null = findNode(newTree, parent);
  if (!parentNode || !parentNode.children) {
    throw new Error(`Parent directory not found: ${parent}`);
  }

  const idx: number = parentNode.children.findIndex(c => c.path === normalized);
  if (idx < 0) {
    throw new Error(`File not found: ${normalized}`);
  }
  if (parentNode.children[idx].type !== 'file') {
    throw new Error(`Not a file: ${normalized}`);
  }

  parentNode.children.splice(idx, 1);
  parentNode.updatedAt = now();

  const op: RevfsOperation = {
    op_id: makeOpId(),
    op_type: RevfsOpType.RemoveFile,
    path: normalized,
    timestamp: now(),
  };

  return [newTree, op];
}
