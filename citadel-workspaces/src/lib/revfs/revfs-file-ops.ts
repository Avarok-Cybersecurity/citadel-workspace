/**
 * RE-VFS File Operations
 *
 * All file-related service methods: upload, download, remove, sent/received tracking.
 * For both peer-scoped (P2P) and server-scoped storage.
 */

import type { RevfsNode, RevfsFileMetadata } from '@/types/revfs-types';
import { RevfsFileState, SENT_FILES_DIR, RECEIVED_FILES_DIR } from '@/types/revfs-types';
import { recordPathFor } from './local-records';
import {
  peerTreeKey,
  findNode,
  placeFile as treePlaceFile,
  removeFile as treeRemoveFile,
} from './tree-operations';
import type { RevfsState } from './revfs-state';
import type { RevfsIO } from './revfs-io';
import { persistTree } from './persist-tree';
import { countByteKeyRefs, byteKeyFor } from './tree-byte-refs';
import { debugLog } from '@/lib/debug-config';
import type { RevfsIntentResult } from '@/types/revfs-intents';

export interface FileOpsContext {
  state: RevfsState;
  ensureIO: () => RevfsIO;
  getTree: (myCid: bigint, peerCid: bigint) => Promise<RevfsNode>;
  getServerTree: (myCid: bigint) => Promise<RevfsNode>;
  sendAndAwaitAck: (peerCid: bigint, op: import('@/types/revfs-types').RevfsOperation, key: import('@/types/revfs-types').TreeKey) => Promise<boolean>;
  sendOp: (peerCid: bigint, operation: import('@/types/revfs-types').RevfsOperation) => Promise<boolean>;
  findFileInTree: (tree: RevfsNode, path: string) => RevfsNode | null;
}

// ── Peer-Scoped File Operations ───────────────────────────────────────────

export async function uploadFileToPeer(
  ctx: FileOpsContext,
  myCid: bigint,
  peerCid: bigint,
  dirPath: string,
  fileName: string,
  metadata: RevfsFileMetadata,
  content: Uint8Array,
): Promise<boolean> {
  const key: string = peerTreeKey(myCid, peerCid);
  const tree: RevfsNode = await ctx.getTree(myCid, peerCid);
  const filePath: string = dirPath.endsWith('/') ? `${dirPath}${fileName}` : `${dirPath}/${fileName}`;
  // Not always `filePath`: see byteKeyFor.
  const byteKey: string = byteKeyFor(tree, filePath, metadata.fileId);
  const io: RevfsIO = ctx.ensureIO();

  // Send the BYTES, then record the file.
  //
  // This path never transmitted any: it placed the node, persisted the tree and
  // sent the peer a tree op describing a file whose contents existed only in
  // the uploader's page. Both peers then showed the file, and neither had it.
  //
  // Same ordering rationale as the server path — a node appears if and only if
  // its bytes were accepted.
  const result: RevfsIntentResult = await io.execute({
    type: 'backend-send-file',
    cid: myCid,
    peerCid,
    fileName,
    content,
    virtualDir: byteKey,
  });

  if (result.type !== 'backend-send-file') throw new Error(`the upload of "${fileName}" was answered with ${result.type}`);
  if (!result.success) throw new Error(`"${fileName}" could not be sent to the peer, so it has not been uploaded. ${result.reason}`);

  // The key the bytes were stored under, recorded at upload time — see
  // uploadFileToServer for why this must not be re-derived from node.path.
  const peerMetadata: RevfsFileMetadata = { ...metadata, virtualDirectory: byteKey };

  const [newTree, op] = treePlaceFile(tree, filePath, peerMetadata, myCid);

  ctx.state.setTree(key, newTree);
  await persistTree(io, key, newTree);
  return ctx.sendAndAwaitAck(peerCid, op, key);
}

export async function removeFileFromPeer(
  ctx: FileOpsContext,
  myCid: bigint,
  peerCid: bigint,
  filePath: string,
): Promise<boolean> {
  const key: string = peerTreeKey(myCid, peerCid);
  const tree: RevfsNode = await ctx.getTree(myCid, peerCid);
  const io: RevfsIO = ctx.ensureIO();

  // Bytes first, node second — the same ordering as the server path. Removing
  // the node first and then discarding the delete result left the bytes with
  // nothing referencing them: storage consumed, and no node left to retry from.
  const fileNode: RevfsNode | null = ctx.findFileInTree(tree, filePath);
  // A copy shares its original's byte key (see tree-byte-refs.ts), so the
  // backend delete only goes out when this node is the LAST reference —
  // otherwise deleting one copy destroyed the bytes every other copy still
  // pointed at, under a green "deleted" toast.
  const sharedElsewhere: boolean =
    fileNode?.fileMetadata !== undefined &&
    countByteKeyRefs(tree, fileNode.fileMetadata.virtualDirectory) > 1;
  if (fileNode?.fileMetadata && !sharedElsewhere) {
    const deleted: RevfsIntentResult = await io.execute({
      type: 'backend-delete-file',
      cid: myCid,
      peerCid,
      // The upload-time key, not the current path — the backend cannot
      // re-path an object. See uploadFileToServer.
      virtualDir: fileNode.fileMetadata.virtualDirectory,
    });

    if (deleted.type !== 'backend-delete-file' || !deleted.success) {
      throw new Error(`"${filePath}" could not be deleted from peer storage. It has been left in place.`);
    }
  } else if (sharedElsewhere) {
    debugLog('RevfsFileOps', `removeFileFromPeer: bytes for ${filePath} still referenced by a copy; node removed, bytes kept`);
  }

  const [newTree, op] = treeRemoveFile(tree, filePath);
  ctx.state.setTree(key, newTree);
  await persistTree(io, key, newTree);

  return ctx.sendAndAwaitAck(peerCid, op, key);
}

export async function downloadFileFromPeer(
  ctx: FileOpsContext,
  myCid: bigint,
  peerCid: bigint,
  filePath: string,
): Promise<string | undefined> {
  const tree: RevfsNode = await ctx.getTree(myCid, peerCid);
  const io: RevfsIO = ctx.ensureIO();

  const fileNode: RevfsNode | null = ctx.findFileInTree(tree, filePath);
  if (!fileNode?.fileMetadata) {
    throw new Error(`File not found or has no metadata: ${filePath}`);
  }

  const result: RevfsIntentResult = await io.execute({
    type: 'backend-download-file',
    cid: myCid,
    peerCid,
    // The upload-time key. See uploadFileToServer.
    virtualDir: fileNode.fileMetadata.virtualDirectory,
  });

  if (result.type !== 'backend-download-file' || !result.success) {
    // A failure used to fall through to `return undefined`, and the UI read
    // that as "Download initiated" — so a download that timed out after 30s
    // and never happened was reported as progress.
    throw new Error(`"${filePath}" could not be downloaded.`);
  }

  return result.downloadPath;
}

// ── Standard Transfer Auto-Population ─────────────────────────────────────

/**
 * Record a chat transfer in this account's Sent Files or Received Files.
 *
 * Local only -- see local-records.ts for why these never reach the peer.
 * Idempotent per transfer id, and a same-named file gets its own entry.
 */
async function addLocalRecord(
  ctx: FileOpsContext,
  myCid: bigint,
  peerCid: bigint,
  dir: string,
  state: RevfsFileState,
  metadata: RevfsFileMetadata,
): Promise<void> {
  const key: string = peerTreeKey(myCid, peerCid);
  const tree: RevfsNode = await ctx.getTree(myCid, peerCid);
  const existing: RevfsNode[] = findNode(tree, dir)?.children ?? [];
  const filePath: string | null = recordPathFor(dir, metadata.fileName, metadata.fileId, existing);
  if (filePath === null) return;

  const [newTree] = treePlaceFile(tree, filePath, metadata, myCid);
  const fileNode: RevfsNode | null = ctx.findFileInTree(newTree, filePath);
  if (fileNode) fileNode.fileState = state;

  ctx.state.setTree(key, newTree);
  const io: RevfsIO = ctx.ensureIO();
  await persistTree(io, key, newTree);
}

export async function addSentFile(
  ctx: FileOpsContext,
  myCid: bigint,
  peerCid: bigint,
  transfer: { fileName: string; fileSize: number; fileType: string; transferId: string },
): Promise<void> {
  await addLocalRecord(ctx, myCid, peerCid, SENT_FILES_DIR, RevfsFileState.Sent, {
    fileId: transfer.transferId,
    fileName: transfer.fileName,
    fileSize: transfer.fileSize,
    fileType: transfer.fileType,
    virtualDirectory: '',
    uploadedByCid: myCid,
  });
}

export async function addReceivedFile(
  ctx: FileOpsContext,
  myCid: bigint,
  peerCid: bigint,
  transfer: { fileName: string; fileSize: number; fileType: string; transferId: string; downloadPath?: string },
): Promise<void> {
  await addLocalRecord(ctx, myCid, peerCid, RECEIVED_FILES_DIR, RevfsFileState.Received, {
    fileId: transfer.transferId,
    fileName: transfer.fileName,
    fileSize: transfer.fileSize,
    fileType: transfer.fileType,
    virtualDirectory: transfer.downloadPath ?? '',
    uploadedByCid: peerCid,
  });
}
