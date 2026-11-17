/**
 * useServerRevfsTree Hook
 *
 * Provides reactive access to the server-scoped RE-VFS tree.
 * Server trees are private to the user and stored on the Citadel server.
 * No P2P sync - operations are local tree + server backend only.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { TreeScope , type RevfsNode } from '@/types/revfs-types';
import { revfsService } from '@/lib/revfs';
import { serverTreeKey, calculateStorageUsage } from '@/lib/revfs/tree-operations';
import { eventEmitter } from '@/lib/event-emitter';
import workspaceService from '@/lib/workspace-service';
import { debugLog } from '@/lib/debug-config';
import type { ReadPulledChunk, UseServerRevfsTreeResult, ServerCapabilities } from './useRevfsTree-types';
import type { PulledChunk } from '@/types/revfs-intents';
import { NOTHING_PENDING } from './useRevfsTree-types';
import { CHECKING, offerOf, serverStorageRefusal, type StorageOffer } from '@/lib/revfs/storage-offer';

export function useServerRevfsTree(myCid: bigint | null): UseServerRevfsTreeResult {
  const [tree, setTree] = useState<RevfsNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Null until the server answers: nothing is assumed about storage it has not said it has.
  const [serverCapabilities, setServerCapabilities] = useState<ServerCapabilities | null>(null);
  const capabilitiesReceived: boolean = serverCapabilities !== null;

  const key: string | null = myCid ? serverTreeKey(myCid) : null;

  // Calculate storage usage from tree (server-stored files)
  const storageUsed: number = useMemo(() => {
    if (!tree) return 0;
    return calculateStorageUsage(tree, TreeScope.Server);
  }, [tree]);

  // Query server capabilities on mount
  //
  // The guard used to be a ref set on first run — which survived the cleanup
  // that REMOVED the listener. The file manager flips myCid to null and back on
  // every Peer/Server toggle, so after one toggle-away the subscription was
  // gone and the ref short-circuited the re-subscribe: if the server's answer
  // landed in that window, the UI kept a permissive default (storage offered)
  // for the rest of the session, advertising storage the server may refuse.
  // There is no default now: until the answer, storage is "checking".
  //
  // The guard is now on whether real capabilities have been RECEIVED, which is
  // the thing it was meant to mean, and it does not outlive the listener.
  useEffect(() => {
    if (!myCid || capabilitiesReceived) return;

    const handleCapabilities = (data: ServerCapabilities): void => {
      setServerCapabilities({
        allowServerFileTransfer: data.allowServerFileTransfer,
        allowServerRevfsStorage: data.allowServerRevfsStorage,
        maxFileTransferSizeMb: data.maxFileTransferSizeMb,
        revfsStorageQuotaMb: data.revfsStorageQuotaMb,
        revfsStorageRefusal: data.revfsStorageRefusal,
      });
    };

    // Listen for capabilities response
    eventEmitter.on('server:capabilities:loaded', handleCapabilities);

    workspaceService.getServerCapabilities().catch((err) => {
      debugLog('UseServerRevfsTree', 'Failed to query server capabilities:', err);
      // Storage stays "checking": an unanswered query offers nothing.
    });

    return (): void => {
      eventEmitter.off('server:capabilities:loaded', handleCapabilities);
    };
  }, [myCid, capabilitiesReceived]);

  const loadTree: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (!myCid) {
      setTree(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const t: RevfsNode = await revfsService.getServerTree(myCid);
      setTree(t);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [myCid]);

  // Load on mount and when CID changes
  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  // Subscribe to tree changes
  useEffect(() => {
    if (!key) return;
    const unsub: () => void = revfsService.onTreeChanged((changedKey, newTree): void => {
      if (changedKey === key) {
        setTree(newTree);
      }
    });
    return unsub;
  }, [key]);

  const mkdir: (path: string) => Promise<boolean> = useCallback(async (path: string): Promise<boolean> => {
    // No session: nothing was written, so nothing was accepted.
    if (!myCid) return false;
    await revfsService.serverMkdir(myCid, path);
    // The server throws on failure, so reaching here IS the acknowledgement.
    return true;
  }, [myCid]);

  const rmdir: (path: string) => Promise<boolean> = useCallback(async (path: string): Promise<boolean> => {
    // No session: nothing was written, so nothing was accepted.
    if (!myCid) return false;
    await revfsService.serverRmdir(myCid, path);
    // The server throws on failure, so reaching here IS the acknowledgement.
    return true;
  }, [myCid]);

  const uploadFile: (dirPath: string, fileName: string, metadata: Parameters<typeof revfsService.uploadFileToServer>[3], content: Uint8Array) => Promise<boolean> = useCallback(async (dirPath: string, fileName: string, metadata: Parameters<typeof revfsService.uploadFileToServer>[3], content: Uint8Array): Promise<boolean> => {
    // No session: nothing was written, so nothing was accepted.
    if (!myCid) return false;
    await revfsService.uploadFileToServer(myCid, dirPath, fileName, metadata, content);
    // The server throws on failure, so reaching here IS the acknowledgement.
    return true;
  }, [myCid]);

  const downloadFile: (filePath: string) => Promise<string | undefined> = useCallback(async (filePath: string): Promise<string | undefined> => {
    if (!myCid) return undefined;
    return revfsService.downloadFileFromServer(myCid, filePath);
  }, [myCid]);

  const readPulledChunk: ReadPulledChunk = useCallback(async (filePath: string, offset: bigint, maxLen: number): Promise<PulledChunk> => {
    if (!myCid) throw new Error('No session to read the file with.');
    return revfsService.readPulledChunk(myCid, null, filePath, offset, maxLen);
  }, [myCid]);

  const removeFile: (filePath: string) => Promise<boolean> = useCallback(async (filePath: string): Promise<boolean> => {
    // No session: nothing was written, so nothing was accepted.
    if (!myCid) return false;
    await revfsService.removeFileFromServer(myCid, filePath);
    // The server throws on failure, so reaching here IS the acknowledgement.
    return true;
  }, [myCid]);

  const rename: (path: string, newName: string) => Promise<boolean> = useCallback(async (path: string, newName: string): Promise<boolean> => {
    // No session: nothing was written, so nothing was accepted.
    if (!myCid) return false;
    await revfsService.serverRename(myCid, path, newName);
    // The server throws on failure, so reaching here IS the acknowledgement.
    return true;
  }, [myCid]);

  const move: (sourcePath: string, destParentPath: string) => Promise<boolean> = useCallback(async (sourcePath: string, destParentPath: string): Promise<boolean> => {
    // No session: nothing was written, so nothing was accepted.
    if (!myCid) return false;
    await revfsService.serverMove(myCid, sourcePath, destParentPath);
    // The server throws on failure, so reaching here IS the acknowledgement.
    return true;
  }, [myCid]);

  const copy: (sourcePath: string, destParentPath: string) => Promise<boolean> = useCallback(async (sourcePath: string, destParentPath: string): Promise<boolean> => {
    // No session: nothing was written, so nothing was accepted.
    if (!myCid) return false;
    await revfsService.serverCopy(myCid, sourcePath, destParentPath);
    // The server throws on failure, so reaching here IS the acknowledgement.
    return true;
  }, [myCid]);

  // The quota the server stated, in bytes; none is offered before it states one.
  const storageQuota: number = serverCapabilities === null ? 0 : serverCapabilities.revfsStorageQuotaMb * 1024 * 1024;
  const storageOffer: StorageOffer = serverCapabilities === null ? CHECKING : offerOf(serverCapabilities.allowServerRevfsStorage, serverStorageRefusal(serverCapabilities.revfsStorageRefusal));

  return {
    tree,
    loading,
    error,
    storageUsed,
    storageQuota,
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
    pendingPaths: NOTHING_PENDING,
  };
}
