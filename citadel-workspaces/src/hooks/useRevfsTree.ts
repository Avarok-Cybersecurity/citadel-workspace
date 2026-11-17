/**
 * useRevfsTree Hook
 *
 * Provides reactive access to the RE-VFS tree for a specific peer pair.
 * Wraps RevfsService with React state management.
 */

import { offerOf, PEER_STORAGE_OFF, type StorageOffer } from '@/lib/revfs/storage-offer';
import { debugLog } from '@/lib/debug-config';
import { useState, useEffect, useCallback, useMemo } from 'react';
import type { RevfsNode, RevfsFileMetadata } from '@/types/revfs-types';
import { TreeScope } from '@/types/revfs-types';
import { revfsService } from '@/lib/revfs';
import { fileTransferService } from '@/lib/file-transfer';
import { peerTreeKey, calculateStorageUsage } from '@/lib/revfs/tree-operations';
import { DEFAULT_QUOTA_BYTES , type ReadPulledChunk, type UseRevfsTreeResult } from './useRevfsTree-types';
import type { PulledChunk } from '@/types/revfs-intents';
import type { FileTransferSettings } from '@/lib/file-transfer/types';

// Re-export the server hook for backward compatibility
export { useServerRevfsTree } from './useServerRevfsTree';

export function useRevfsTree(myCid: bigint | null, peerCid: bigint | null): UseRevfsTreeResult {
  const [tree, setTree] = useState<RevfsNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingPaths, setPendingPaths] = useState<ReadonlySet<string>>(new Set<string>());

  const key: string | null = myCid && peerCid ? peerTreeKey(myCid, peerCid) : null;

  const storageUsed: number = useMemo(() => {
    if (!tree) return 0;
    return calculateStorageUsage(tree, TreeScope.Peer);
  }, [tree]);

  const { storageOffer, actualQuota } = useMemo((): { storageOffer: StorageOffer; actualQuota: number } => {
    if (!peerCid) return { storageOffer: offerOf(false, PEER_STORAGE_OFF), actualQuota: DEFAULT_QUOTA_BYTES };
    const settings: FileTransferSettings = fileTransferService.getSettings(peerCid.toString());
    return {
      storageOffer: offerOf(settings.allowRevfsStorage, PEER_STORAGE_OFF),
      actualQuota: settings.revfsQuota,
    };
  }, [peerCid]);

  const loadTree: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (!myCid || !peerCid) {
      setTree(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const t: RevfsNode = await revfsService.getTree(myCid, peerCid);
      setTree(t);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [myCid, peerCid]);

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  /**
   * Re-read what the service holds once a change of ours has settled.
   *
   * The tree-changed event is the fast path, and it depends on the event's key
   * matching this view's key. When it does not fire for any reason, an upload
   * the service has recorded stayed off screen with "0 B used" beside it. The
   * service's cache is the authority, so the view asks it directly; the same
   * moment is when an acknowledgement has arrived or been given up on, so the
   * pending marks are refreshed here too.
   */
  const afterChange: <T>(change: Promise<T>) => Promise<T> = useCallback(async <T,>(change: Promise<T>): Promise<T> => {
    try {
      return await change;
    } finally {
      if (myCid && peerCid) {
        setPendingPaths(revfsService.pendingPaths(myCid, peerCid));
        await revfsService.getTree(myCid, peerCid).then(setTree, (): void => {});
      }
    }
  }, [myCid, peerCid]);

  useEffect(() => {
    if (!key) return;
    const unsub: () => void = revfsService.onTreeChanged((changedKey, newTree): void => {
      // Logged because CI cannot otherwise tell these apart: `peerRmdir`
      // reports the folder removed, persisted AND acknowledged by the peer,
      // and the row stays on screen. Every link between the two checks out by
      // reading -- setTree notifies, this is subscribed, the view renders
      // `activeTree.tree`, and `peerTreeKey` sorts its cids so both sides
      // agree -- so the thing to find out is which link does not fire.
      debugLog('UseRevfsTree', 'tree changed', {
        changedKey,
        mine: key,
        matches: changedKey === key,
        topLevel: (newTree.children ?? []).map((c) => c.name).join(','),
      });
      if (changedKey === key) {
        setTree(newTree);
        if (myCid && peerCid) setPendingPaths(revfsService.pendingPaths(myCid, peerCid));
      }
    });
    return unsub;
  }, [key, myCid, peerCid]);

  const mkdir: (path: string) => Promise<boolean> = useCallback(async (path: string): Promise<boolean> => {
    // No session: the peer certainly has not acknowledged anything.
    if (!myCid || !peerCid) return false;
    return afterChange(revfsService.mkdir(myCid, peerCid, path));
  }, [myCid, peerCid, afterChange]);

  const rmdir: (path: string) => Promise<boolean> = useCallback(async (path: string): Promise<boolean> => {
    // No session: the peer certainly has not acknowledged anything.
    if (!myCid || !peerCid) return false;
    return afterChange(revfsService.rmdir(myCid, peerCid, path));
  }, [myCid, peerCid, afterChange]);

  const uploadFile: (dirPath: string, fileName: string, metadata: RevfsFileMetadata, content: Uint8Array) => Promise<boolean> = useCallback(async (dirPath: string, fileName: string, metadata: RevfsFileMetadata, content: Uint8Array): Promise<boolean> => {
    // No session: the peer certainly has not acknowledged anything.
    if (!myCid || !peerCid) return false;
    return afterChange(revfsService.uploadFileToPeer(myCid, peerCid, dirPath, fileName, metadata, content));
  }, [myCid, peerCid, afterChange]);

  const downloadFile: (filePath: string) => Promise<string | undefined> = useCallback(async (filePath: string): Promise<string | undefined> => {
    if (!myCid || !peerCid) return undefined;
    return revfsService.downloadFileFromPeer(myCid, peerCid, filePath);
  }, [myCid, peerCid]);

  const readPulledChunk: ReadPulledChunk = useCallback(async (filePath: string, offset: bigint, maxLen: number): Promise<PulledChunk> => {
    if (!myCid || !peerCid) throw new Error('No session to read the file with.');
    return revfsService.readPulledChunk(myCid, peerCid, filePath, offset, maxLen);
  }, [myCid, peerCid]);

  const removeFile: (filePath: string) => Promise<boolean> = useCallback(async (filePath: string): Promise<boolean> => {
    // No session: the peer certainly has not acknowledged anything.
    if (!myCid || !peerCid) return false;
    return afterChange(revfsService.removeFileFromPeer(myCid, peerCid, filePath));
  }, [myCid, peerCid, afterChange]);

  const rename: (path: string, newName: string) => Promise<boolean> = useCallback(async (path: string, newName: string): Promise<boolean> => {
    // No session: the peer certainly has not acknowledged anything.
    if (!myCid || !peerCid) return false;
    return afterChange(revfsService.rename(myCid, peerCid, path, newName));
  }, [myCid, peerCid, afterChange]);

  const move: (sourcePath: string, destParentPath: string) => Promise<boolean> = useCallback(async (sourcePath: string, destParentPath: string): Promise<boolean> => {
    // No session: the peer certainly has not acknowledged anything.
    if (!myCid || !peerCid) return false;
    return afterChange(revfsService.move(myCid, peerCid, sourcePath, destParentPath));
  }, [myCid, peerCid, afterChange]);

  const copy: (sourcePath: string, destParentPath: string) => Promise<boolean> = useCallback(async (sourcePath: string, destParentPath: string): Promise<boolean> => {
    // No session: the peer certainly has not acknowledged anything.
    if (!myCid || !peerCid) return false;
    return afterChange(revfsService.copy(myCid, peerCid, sourcePath, destParentPath));
  }, [myCid, peerCid, afterChange]);

  return {
    tree,
    loading,
    error,
    storageUsed,
    storageQuota: actualQuota,
    storageOffer,
    mkdir,
    rmdir,
    uploadFile,
    downloadFile,
    readPulledChunk,
    removeFile,
    rename,
    move,
    copy,
    refresh: loadTree,
    pendingPaths,
  };
}
