/**
 * Server-scoped file operations.
 *
 * Split from the peer-scoped half so revfs-file-ops keeps the P2P path — where
 * the ack and tree-op reasoning lives — and this keeps the backend-storage path.
 */

import type { RevfsNode, RevfsFileMetadata } from '@/types/revfs-types';
import { RevfsFileState } from '@/types/revfs-types';
import {
  serverTreeKey,
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


export async function uploadFileToServer(
  ctx: FileOpsContext,
  myCid: bigint,
  dirPath: string,
  fileName: string,
  metadata: RevfsFileMetadata,
  content: Uint8Array,
): Promise<void> {
  const key: string = serverTreeKey(myCid);
  const tree: RevfsNode = await ctx.getServerTree(myCid);
  const filePath: string = dirPath.endsWith('/') ? `${dirPath}${fileName}` : `${dirPath}/${fileName}`;
  // Not always `filePath`: see byteKeyFor.
  const byteKey: string = byteKeyFor(tree, filePath, metadata.fileId);
  const io: RevfsIO = ctx.ensureIO();

  // Bytes FIRST, tree second.
  //
  // This used to place the node and persist the tree before calling the
  // backend, then await the backend result and DISCARD it — with no rollback.
  // Combined with the request being rejected client-side, that produced a file
  // that existed in the tree, counted against the quota, and had no bytes
  // anywhere, under a green "Uploaded" toast.
  //
  // A node now appears if and only if its bytes were accepted. That costs the
  // optimistic render, which nothing here depended on: there is no progress UI,
  // and a file that silently is not there is far worse than one that takes a
  // moment to appear.
  const result: RevfsIntentResult = await io.execute({
    type: 'backend-send-file',
    cid: myCid,
    peerCid: null,
    fileName,
    content,
    virtualDir: byteKey,
  });

  if (result.type !== 'backend-send-file') throw new Error(`the upload of "${fileName}" was answered with ${result.type}`);
  if (!result.success) throw new Error(`The server did not accept "${fileName}", so it has not been uploaded. ${result.reason}`);

  const serverMetadata: RevfsFileMetadata = {
    ...metadata,
    uploadedByCid: myCid,
    // The key the bytes were stored under, recorded at upload time.
    //
    // NOT re-derived from `node.path` later: the backend has send/download/delete
    // and no way to re-path an object, so the server-side key is immutable. A
    // rename or move rewrites `node.path` and CANNOT move the bytes — so a
    // download that derived its key from the current path would miss every
    // renamed file. This field is the upload-time SSOT for that key; anyone
    // "fixing" it to track node.path will break exactly those files.
    //
    // What it must NOT be is what the UI passes in: `targetPath`, the containing
    // DIRECTORY. That is what made downloads and deletes address `/docs` for a
    // file stored at `/docs/notes.txt`.
    virtualDirectory: byteKey,
  };

  const [newTree] = treePlaceFile(tree, filePath, serverMetadata, myCid);
  const fileNode: RevfsNode | null = ctx.findFileInTree(newTree, filePath);
  if (fileNode) fileNode.fileState = RevfsFileState.ServerStored;

  ctx.state.setTree(key, newTree);
  await persistTree(io, key, newTree);
}

export async function removeFileFromServer(
  ctx: FileOpsContext,
  myCid: bigint,
  filePath: string,
): Promise<void> {
  const key: string = serverTreeKey(myCid);
  const tree: RevfsNode = await ctx.getServerTree(myCid);
  const io: RevfsIO = ctx.ensureIO();

  // Delete the bytes BEFORE dropping the node, and stop if that fails.
  //
  // The node used to be removed and persisted first, then the backend delete
  // issued and its result ignored. A failed delete therefore left the bytes on
  // the server with nothing in the tree referencing them — storage consumed
  // permanently, with no node left to retry from. Removing the node is the
  // irreversible half locally, so it goes last.
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
      peerCid: null,
      // The upload-time key, not the current path. See uploadFileToServer:
      // the backend cannot re-path an object, so a renamed file's bytes stay
      // where they were written.
      virtualDir: fileNode.fileMetadata.virtualDirectory,
    });

    if (deleted.type !== 'backend-delete-file' || !deleted.success) {
      throw new Error(
        `"${filePath}" could not be deleted from server storage. It has been left in place.`
      );
    }
  } else if (sharedElsewhere) {
    debugLog('RevfsServerFileOps', `removeFileFromServer: bytes for ${filePath} still referenced by a copy; node removed, bytes kept`);
  }

  const [newTree] = treeRemoveFile(tree, filePath);
  ctx.state.setTree(key, newTree);
  await persistTree(io, key, newTree);
}

export async function downloadFileFromServer(
  ctx: FileOpsContext,
  myCid: bigint,
  filePath: string,
): Promise<string | undefined> {
  const tree: RevfsNode = await ctx.getServerTree(myCid);
  const io: RevfsIO = ctx.ensureIO();

  const fileNode: RevfsNode | null = ctx.findFileInTree(tree, filePath);
  if (!fileNode?.fileMetadata) {
    throw new Error(`File not found or has no metadata: ${filePath}`);
  }

  const result: RevfsIntentResult = await io.execute({
    type: 'backend-download-file',
    cid: myCid,
    peerCid: null,
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
