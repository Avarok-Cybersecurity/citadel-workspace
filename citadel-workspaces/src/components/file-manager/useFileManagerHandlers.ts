import { useCallback } from "react";
import { useDropUpload } from './useDropUpload';
import { describeError } from '@/lib/describe-error';
import { useFileManagerSelectionHandlers } from './useFileManagerSelectionHandlers';
import { useFileManagerDeleteHandlers } from './useFileManagerDeleteHandlers';
import { toast } from "sonner";
import type { StorageOffer } from "@/lib/revfs/storage-offer";
import type { RevfsNode, TreeKey, RevfsFileMetadata } from "@/types/revfs-types";
import { TreeScope } from "@/types/revfs-types";
import { revfsService } from "@/lib/revfs";
import { peerTreeKey } from "@/lib/revfs/tree-queries";
import { useFileManagerDownload } from './useFileManagerDownload';
import type { RevfsDownloadHistory } from '@/lib/revfs/download-history';
import type { FileDetails } from '@/components/layout/sidebar/file-details';
import { usePrompt } from "@/components/shared/prompt-dialog";
import { reportDelivery } from './report-delivery';
import { syncNotice, type SyncNotice } from './sync-notice';
import type { SyncOutcome } from '@/lib/revfs/revfs-service';
import { entryNameError } from './vfs-content-helpers';

interface HandlerDeps {
  mkdir: (path: string) => Promise<boolean>;
  rmdir: (path: string) => Promise<boolean>;
  removeFile: (path: string) => Promise<boolean>;
  downloadFile: (path: string) => Promise<string | undefined>;
  uploadFile: (dir: string, name: string, metadata: RevfsFileMetadata, content: Uint8Array) => Promise<boolean>;
  rename: (path: string, newName: string) => Promise<boolean>;
  move: (src: string, dest: string) => Promise<boolean>;
  copy: (src: string, dest: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  cut: (items: RevfsNode[], treeKey: TreeKey) => void;
  copyToClipboard: (items: RevfsNode[], treeKey: TreeKey) => void;
  clearClipboard: () => void;
  clearSelection: () => void;
  selectAll: (paths: string[]) => void;
  /** The grid's filter, so Select All cannot reach what is hidden. */ filterText: string;
  currentTreeKey: TreeKey | null;
  hasPasteItems: boolean;
  clipboard: { sourceTreeKey: TreeKey | null; items: RevfsNode[] };
  isCut: boolean;
  myCid: bigint | null;
  storageUsed: number;
  storageQuota: number;
  storageOffer: StorageOffer;
  storageMode: TreeScope;
  selectedPeerCid: bigint | null;
  tree: RevfsNode | null;
  currentPath: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  chooseUploadTarget: (dir: string) => void;
  setRevfsDisabledReason: (reason: 'peer_disabled' | 'server_disabled') => void;
  setRevfsDisabledModalOpen: (open: boolean) => void;
  setAttemptedFileSize: (size: number) => void;
  setStorageLimitModalOpen: (open: boolean) => void;
  /** Show an item in the inspector. */
  inspect: (node: RevfsNode) => void;
  /** Named in the download toasts and the FILES list: whose storage it came from. */
  storageLabel: string;
  downloadHistory: RevfsDownloadHistory;
  showFile: (details: FileDetails) => void;
}

export function useFileManagerHandlers({
  mkdir, rmdir, removeFile, downloadFile, uploadFile, rename, move, copy, refresh,
  cut, copyToClipboard, clearClipboard, clearSelection, selectAll,
  currentTreeKey, hasPasteItems, clipboard, isCut,
  myCid, storageUsed, storageQuota, storageOffer, storageMode, selectedPeerCid,
  tree, currentPath, filterText, fileInputRef,
  chooseUploadTarget, setRevfsDisabledReason, setRevfsDisabledModalOpen,
  setAttemptedFileSize, setStorageLimitModalOpen, inspect,
  storageLabel, downloadHistory, showFile,
}: HandlerDeps): { handleNewFolder: (parentPath: string) => Promise<void>; handleDelete: (node: RevfsNode) => Promise<void>; handleDownload: (node: RevfsNode) => void; handleUploadFile: (dirPath: string) => void; handleInfo: (node: RevfsNode) => void; handleRename: (path: string, newName: string) => Promise<void>; handleCut: (node: RevfsNode) => void; handleCopy: (node: RevfsNode) => void; handlePaste: (destPath: string) => Promise<void>; handleDeleteMultiple: (nodes: RevfsNode[]) => Promise<void>; handleCutMultiple: (nodes: RevfsNode[]) => void; handleCopyMultiple: (nodes: RevfsNode[]) => void; handleSelectAll: () => void; handleDrop: (targetPath: string, files: FileList) => Promise<void>; handleSync: () => Promise<void>; handleMove: (nodes: RevfsNode[], destination: string) => Promise<void>; } {
  const prompt: ReturnType<typeof usePrompt> = usePrompt();

  const handleNewFolder: (parentPath: string) => Promise<void> = useCallback(async (parentPath: string): Promise<void> => {
    const name: string | null = await prompt({
      title: 'New folder',
      label: 'Folder name',
      placeholder: 'Designs',
      confirmLabel: 'Create folder',
    });
    // usePrompt resolves null on cancel or an empty name, exactly as the native
    // prompt did, so this guard is unchanged.
    if (!name?.trim()) return;
    const invalid: string | null = entryNameError(name.trim());
    if (invalid) { toast.error(`Cannot create folder: ${invalid}`); return; }
    const path: string = parentPath === '/' ? `/${name.trim()}` : `${parentPath}/${name.trim()}`;
    mkdir(path)
      .then(acknowledged => reportDelivery(acknowledged, `Created "${name.trim()}"`))
      .catch(err => toast.error(`Failed to create folder: ${describeError(err)}`));
  }, [mkdir, prompt]);

  const requestShare: (node: RevfsNode) => Promise<string | undefined> = useCallback(async (node: RevfsNode): Promise<string | undefined> => {
    const owner: bigint | undefined = node.fileMetadata?.uploadedByCid;
    if (owner === undefined) throw new Error(`${node.name} does not say who uploaded it.`);
    return revfsService.requestShare(owner, storageLabel, node.path);
  }, [storageLabel]);

  const handleDownload: (node: RevfsNode) => void = useFileManagerDownload({
    downloadFile, requestShare, myCid, sourceCid: storageMode === TreeScope.Peer ? selectedPeerCid : null,
    sourceLabel: storageLabel, history: downloadHistory, showFile, now: Date.now,
  });

  const handleUploadFile: (dirPath: string) => void = useCallback((dirPath: string): void => {
    chooseUploadTarget(dirPath);
    fileInputRef.current?.click();
  }, [chooseUploadTarget, fileInputRef]);

  const handleInfo: (node: RevfsNode) => void = inspect;

  const handleRename: (path: string, newName: string) => Promise<void> = useCallback(async (path: string, newName: string): Promise<void> => {
    try {
      const acknowledged: boolean = await rename(path, newName);
      reportDelivery(acknowledged, `Renamed to "${newName}"`);
    } catch (err) {
      toast.error(`Failed to rename: ${describeError(err)}`);
    }
  }, [rename]);

  const handleCut: (node: RevfsNode) => void = useCallback((node: RevfsNode): void => {
    if (!currentTreeKey) return;
    cut([node], currentTreeKey);
    toast.info(`Cut: ${node.name}`);
  }, [cut, currentTreeKey]);

  const handleCopy: (node: RevfsNode) => void = useCallback((node: RevfsNode): void => {
    if (!currentTreeKey) return;
    copyToClipboard([node], currentTreeKey);
    toast.info(`Copied: ${node.name}`);
  }, [copyToClipboard, currentTreeKey]);

  const handlePaste: (destPath: string) => Promise<void> = useCallback(async (destPath: string): Promise<void> => {
    if (!hasPasteItems || !currentTreeKey) return;
    if (clipboard.sourceTreeKey !== currentTreeKey) {
      toast.error('Cannot paste between different storage trees');
      return;
    }
    try {
      // Every item must land for this to be a delivered paste. One that did
      // not is the whole message -- the peer's view is incomplete either way.
      let allAcknowledged: boolean = true;
      for (const item of clipboard.items) {
        const acknowledged: boolean = isCut ? await move(item.path, destPath) : await copy(item.path, destPath);
        allAcknowledged = allAcknowledged && acknowledged;
      }
      reportDelivery(allAcknowledged, `Pasted ${clipboard.items.length} item(s)`);
      clearClipboard();
    } catch (err) {
      toast.error(`Failed to paste: ${describeError(err)}`);
    }
  }, [hasPasteItems, currentTreeKey, clipboard, isCut, move, copy, clearClipboard]);

  // "Move to…": every item must land for it to be reported as moved, as Paste.
  const handleMove: (nodes: RevfsNode[], destination: string) => Promise<void> = useCallback(async (nodes: RevfsNode[], destination: string): Promise<void> => {
    try {
      let allAcknowledged: boolean = true;
      for (const node of nodes) allAcknowledged = (await move(node.path, destination)) && allAcknowledged;
      reportDelivery(allAcknowledged, `Moved ${nodes.length === 1 ? nodes[0].name : `${nodes.length} items`}`);
    } catch (err) {
      toast.error(`Failed to move: ${describeError(err)}`);
    }
  }, [move]);

  const { handleDelete, handleDeleteMultiple } =
    useFileManagerDeleteHandlers({ rmdir, removeFile, clearSelection });

  const { handleCutMultiple, handleCopyMultiple, handleSelectAll } =
    useFileManagerSelectionHandlers({ tree, currentPath, filterText, currentTreeKey, cut, copyToClipboard, selectAll });

  // See useDropUpload: the quota a drop must fit is not a number the tree can
  // answer alone, because uploads already in the air are not in it yet.
  const handleDrop: (targetPath: string, files: FileList) => Promise<void> = useDropUpload({
    myCid, storageOffer, storageMode, storageUsed, storageQuota, uploadFile, reportDelivery,
    setRevfsDisabledReason, setRevfsDisabledModalOpen, setAttemptedFileSize, setStorageLimitModalOpen,
  });

  const handleSync: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      if (storageMode === TreeScope.Peer) {
        // Peer mode only auto-selects a peer when at least one is registered, so
        // "peer mode with no peer" is reachable and used to fall through to the
        // ...telling the user their tree synced when nothing was requested.
        if (!myCid || !selectedPeerCid) {
          toast.error('No peer selected', {
            description: 'Choose a peer to sync with, or switch to server storage.',
          });
          return;
        }
        const outcome: SyncOutcome = await revfsService.requestSync(myCid, selectedPeerCid);

        // Flush the queue before claiming a sync; see lib/revfs/revfs-retry.ts.
        const { stillPending, discarded } = await revfsService.retryPendingOps(peerTreeKey(myCid, selectedPeerCid), selectedPeerCid);
        await refresh();
        const notice: SyncNotice | null = syncNotice(outcome, storageLabel);
        // Discarded first: unrecoverable, and it used to read as a successful sync.
        if (discarded > 0) {
          toast.error('Some changes were not delivered', {
            description: `${discarded} change(s) were given up on after repeated failures. The peer does not have them.`,
          });
        } else if (stillPending > 0) {
          toast.error('Some changes could not be sent', {
            description: `${stillPending} operation(s) still queued; they will be retried.`,
          });
        } else if (notice) {
          toast.error(notice.title, { description: notice.description });
        } else { toast.success('Tree synced with peer'); }
        return;
      }
      // Server mode: nothing is exchanged with a peer, so do not claim it was.
      await refresh();
      toast.success('Tree refreshed');
    } catch (err) { toast.error(`Sync failed: ${describeError(err)}`); }
  }, [storageMode, myCid, selectedPeerCid, refresh, storageLabel]);

  return {
    handleNewFolder, handleDelete, handleDownload, handleUploadFile, handleInfo,
    handleRename, handleCut, handleCopy, handlePaste,
    handleDeleteMultiple, handleCutMultiple, handleCopyMultiple,
    handleSelectAll, handleDrop, handleSync, handleMove,
  };
}
