/**
 * RE-VFS OPFS Storage Adapter
 *
 * Persists tree and pending operations to the Origin Private File System.
 * Storage layout: revfs/{treeKey}/tree.json, pending_ops.json
 *
 * Supports both P2P (PeerPairKey) and server (ServerTreeKey) scoped trees.
 * - PeerPairKey: "123_456" (min_max CID pair)
 * - ServerTreeKey: "server_123" (user's server storage)
 *
 * This is the only module that touches OPFS — all other code uses RevfsIntent.
 */

import type { RevfsNode, RevfsPendingOp, TreeKey } from '@/types/revfs-types';

const ROOT_DIR_NAME: string = 'revfs';
const TREE_FILE: string = 'tree.json';
const PENDING_OPS_FILE: string = 'pending_ops.json';

/**
 * BigInt-safe JSON serializer for RevfsNode trees.
 * Converts bigint values to tagged objects for round-trip fidelity.
 */
function serializeTree(data: unknown): string {
  return JSON.stringify(data, (_key, value) =>
    typeof value === 'bigint' ? { __bigint__: value.toString() } : value
  );
}

function deserializeTree<T>(json: string): T {
  return JSON.parse(json, (_key, value) => {
    if (value && typeof value === 'object' && '__bigint__' in value) {
      return BigInt(value.__bigint__ as string);
    }
    return value;
  }) as T;
}

export class RevfsOpfsStorage {
  private async getRootDir(): Promise<FileSystemDirectoryHandle> {
    const root: FileSystemDirectoryHandle = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(ROOT_DIR_NAME, { create: true });
  }

  private async getTreeDir(key: TreeKey): Promise<FileSystemDirectoryHandle> {
    const rootDir: FileSystemDirectoryHandle = await this.getRootDir();
    return rootDir.getDirectoryHandle(key, { create: true });
  }

  private async writeFile(dir: FileSystemDirectoryHandle, name: string, content: string): Promise<void> {
    const fileHandle: FileSystemFileHandle = await dir.getFileHandle(name, { create: true });
    const writable: FileSystemWritableFileStream = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  /**
   * `null` ONLY when the file is genuinely absent.
   *
   * This used to catch everything and return null, so a revoked handle, a
   * quota error, a locked file or any transient `NotReadableError` was
   * indistinguishable from a first run. `loadTree` returned null, the service
   * built a default tree and persisted it -- over a tree that was still on
   * disk. A read failure destroyed the user's files.
   *
   * Every other error is rethrown so the caller can tell "nothing here" from
   * "could not look".
   */
  private async readFile(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
    try {
      const fileHandle: FileSystemFileHandle = await dir.getFileHandle(name);
      const file: File = await fileHandle.getFile();
      return await file.text();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') return null;
      throw err;
    }
  }

  async saveTree(key: TreeKey, tree: RevfsNode): Promise<void> {
    const dir: FileSystemDirectoryHandle = await this.getTreeDir(key);
    await this.writeFile(dir, TREE_FILE, serializeTree(tree));
  }

  async loadTree(key: TreeKey): Promise<RevfsNode | null> {
    const dir: FileSystemDirectoryHandle = await this.getTreeDir(key);
    const json: string | null = await this.readFile(dir, TREE_FILE);
    if (!json) return null;
    return deserializeTree<RevfsNode>(json);
  }

  async savePendingOps(key: TreeKey, ops: RevfsPendingOp[]): Promise<void> {
    const dir: FileSystemDirectoryHandle = await this.getTreeDir(key);
    await this.writeFile(dir, PENDING_OPS_FILE, serializeTree(ops));
  }

  async loadPendingOps(key: TreeKey): Promise<RevfsPendingOp[]> {
    const dir: FileSystemDirectoryHandle = await this.getTreeDir(key);
    const json: string | null = await this.readFile(dir, PENDING_OPS_FILE);
    if (!json) return [];
    return deserializeTree<RevfsPendingOp[]>(json);
  }
}
