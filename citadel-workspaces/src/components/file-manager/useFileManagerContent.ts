import { useState, useCallback, useRef, useEffect, useMemo, type RefObject, type Dispatch, type SetStateAction } from "react";
import { useRevfsTree, useServerRevfsTree } from "@/hooks/useRevfsTree";
import { useVFSClipboard } from "@/hooks/useVFSClipboard";
import { useVFSSelection  } from "@/hooks/useVFSSelection";
import { getCurrentCid } from "@/lib/p2p/current-cid";
import { useRegisteredPeers } from "@/hooks/use-registered-peers";
import { storagePeersFrom, type StoragePeer } from "./storage-peers";
import { useFileManagerPlace, type FileManagerPlace } from './useFileManagerPlace';
import type { StorageRef } from '@/lib/file-manager-location';
import { peerTreeKey, serverTreeKey } from "@/lib/revfs/tree-operations";
import type { RevfsNode, TreeKey } from "@/types/revfs-types";
import type { PulledChunk } from '@/types/revfs-intents';
import { TreeScope } from "@/types/revfs-types";
import { INTERVAL } from "@/lib/timeout-constants";
import { useFileManagerHandlers } from "./useFileManagerHandlers";
import { useUploadTarget, type UploadTarget } from './useUploadTarget';
import type { SortField, SortDirection } from './vfs-content-helpers';
import { useLinkedItem } from './useLinkedItem';
import { agentFileReader, type WorkspaceFileReader } from './docs-file-open';
import { revfsDownloadHistory } from '@/lib/revfs/download-history';
import type { FileDetails } from '@/components/layout/sidebar/file-details';
import type { UseRevfsTreeResult, UseServerRevfsTreeResult } from '@/hooks/useRevfsTree-types';

export { findNodeByPath } from '@/lib/revfs/tree-operations';

/**
 * Derived from the hooks it composes rather than restated: the handler block
 * and the three tree/clipboard/selection members would otherwise be a second
 * copy of shapes that already have one authority.
 */
export type UseFileManagerContentResult = ReturnType<typeof useFileManagerHandlers> & {
  myCid: bigint | null;
  registeredPeers: StoragePeer[];
  peersLoading: boolean;
  /** The address: whose storage, which folder, and how to move between them. */
  place: FileManagerPlace;
  /** The storage the address names, resolved for this viewer. */
  storage: StorageRef;
  /** Whether that storage is a peer you are registered with. */
  peerRegistered: boolean;
  /** The peer whose storage is open; null for the server or a peer that cannot be opened. */
  selectedPeerCid: bigint | null;
  storageMode: TreeScope;
  tree: UseServerRevfsTreeResult['tree'];
  loading: UseServerRevfsTreeResult['loading'];
  error: UseServerRevfsTreeResult['error'];
  refresh: UseServerRevfsTreeResult['refresh'];
  storageUsed: UseServerRevfsTreeResult['storageUsed'];
  storageQuota: UseServerRevfsTreeResult['storageQuota'];
  storageOffer: UseServerRevfsTreeResult['storageOffer'];
  pendingPaths: UseServerRevfsTreeResult['pendingPaths'];
  storageLabel: string;
  /** What the storage is called on screen: "Server Storage", "Shared with Bob". */
  storageName: string;
  currentPath: string;
  /** An item a link pointed at that is not in the folder. */
  missingItem: string | null;
  /** Has the agent pull a file (DownloadFile) without the download toast, for an app to read it. */
  /** Reads a stored file's bytes for an app that opens it in the page (Citadel Docs). */
  fileReader: WorkspaceFileReader;
  fileInputRef: RefObject<HTMLInputElement>;
  /** The folder a picked file lands in; see useUploadTarget. */
  takeUploadTarget: UploadTarget['take'];
  storageLimitModalOpen: boolean;
  setStorageLimitModalOpen: Dispatch<SetStateAction<boolean>>;
  attemptedFileSize: number;
  revfsDisabledModalOpen: boolean;
  setRevfsDisabledModalOpen: Dispatch<SetStateAction<boolean>>;
  revfsDisabledReason: 'peer_disabled' | 'server_disabled';
  /** The file a "Show" asked for, in the FILES list's own dialog. */
  shownFile: FileDetails | null;
  setShownFile: Dispatch<SetStateAction<FileDetails | null>>;
  sortField: SortField;
  sortDirection: SortDirection;
  filterText: string;
  setFilterText: Dispatch<SetStateAction<string>>;
  handleSortChange: (field: SortField, direction: SortDirection) => void;
  cutItemPaths: Set<string>;
  hasPasteItems: ReturnType<typeof useVFSClipboard>['hasItems'];
  selectedPaths: ReturnType<typeof useVFSSelection>['selectedPaths'];
  selectItem: ReturnType<typeof useVFSSelection>['select'];
  clearSelection: ReturnType<typeof useVFSSelection>['clearSelection'];
  selectPaths: ReturnType<typeof useVFSSelection>['selectAll'];
};

export function useFileManagerContent(): UseFileManagerContentResult {
  const [myCid, setMyCid] = useState<bigint | null>(null);
  // The list the sidebar shows, fetched from the agent. This read the
  // registration service's cache, which only a registration seen in THIS tab
  // fills, so a registered, online peer read as "No Peers Connected".
  const { registeredPeers: listed, isLoading: peersLoading } = useRegisteredPeers();
  const registeredPeers: StoragePeer[] = useMemo((): StoragePeer[] => storagePeersFrom(listed), [listed]);

  // The tab's own session, not the global connection: a tab that resumed its
  // session has no connection info for seconds, and that was "Connecting..."
  useEffect(() => {
    let live: boolean = true;
    const update = (): void => {
      getCurrentCid().then(
        (cid: bigint | null): void => { if (live) setMyCid(cid); },
        (): void => { if (live) setMyCid(null); },
      );
    };
    update();
    const interval: NodeJS.Timeout = setInterval(update, INTERVAL.HEARTBEAT_MS);
    return (): void => { live = false; clearInterval(interval); };
  }, []);

  // Whose storage is the address's to say. An effect used to fill an empty
  // choice with `registeredPeers[0]`, which is how the sidebar's File Manager
  // opened on whichever member sorted first.
  const place: FileManagerPlace = useFileManagerPlace(myCid);
  const { storage } = place;
  const openPeer: StoragePeer | undefined = storage.kind === 'peer'
    ? registeredPeers.find((p: StoragePeer): boolean => p.cid === storage.cid)
    : undefined;
  const peerRegistered: boolean = openPeer !== undefined && openPeer.cid !== myCid;
  const selectedPeerCid: bigint | null = peerRegistered && openPeer ? openPeer.cid : null;
  const storageMode: TreeScope = storage.kind === 'server' ? TreeScope.Server : TreeScope.Peer;

  const peerTree: UseRevfsTreeResult = useRevfsTree(
    storageMode === TreeScope.Peer ? myCid : null,
    storageMode === TreeScope.Peer ? selectedPeerCid : null
  );
  const serverTree: UseServerRevfsTreeResult = useServerRevfsTree(storageMode === TreeScope.Server ? myCid : null);
  const activeTree: UseServerRevfsTreeResult = storageMode === TreeScope.Server ? serverTree : peerTree;
  const { tree, loading, error, mkdir, rmdir, uploadFile, downloadFile, readPulledChunk, removeFile, rename, move, copy, refresh, storageUsed, storageQuota, storageOffer, pendingPaths } = activeTree;

  const { clipboard, cut, copy: copyToClipboard, clear: clearClipboard, hasItems: hasPasteItems, isCut } = useVFSClipboard();
  const { selectedPaths, select: selectItem, selectAll, clearSelection } = useVFSSelection();

  const currentTreeKey: TreeKey | null = useMemo(() => {
    if (storageMode === TreeScope.Server && myCid) return serverTreeKey(myCid);
    if (storageMode === TreeScope.Peer && myCid && selectedPeerCid) return peerTreeKey(myCid, selectedPeerCid);
    return null;
  }, [storageMode, myCid, selectedPeerCid]);

  const cutItemPaths: Set<string> = useMemo(() => {
    if (!isCut || !currentTreeKey || clipboard.sourceTreeKey !== currentTreeKey) return new Set<string>();
    return new Set(clipboard.items.map(item => item.path));
  }, [isCut, currentTreeKey, clipboard.sourceTreeKey, clipboard.items]);

  // The name the rest of the app shows for them (useRegisteredPeers resolves it against the roster).
  const peerName: string | null = openPeer ? openPeer.displayName : null;
  const storageLabel: string = storageMode === TreeScope.Server ? 'Server' : peerName ?? 'Peer';
  const storageName: string = storageMode === TreeScope.Server ? 'Server Storage' : `Shared with ${peerName ?? 'this peer'}`;

  const currentPath: string = place.path;
  const fileInputRef: RefObject<HTMLInputElement> = useRef<HTMLInputElement>(null);
  const uploadTarget: UploadTarget = useUploadTarget(currentPath);

  const [storageLimitModalOpen, setStorageLimitModalOpen] = useState(false);
  const [attemptedFileSize, setAttemptedFileSize] = useState(0);
  const [revfsDisabledModalOpen, setRevfsDisabledModalOpen] = useState(false);
  const [revfsDisabledReason, setRevfsDisabledReason] = useState<'peer_disabled' | 'server_disabled'>('peer_disabled');
  const [shownFile, setShownFile] = useState<FileDetails | null>(null);

  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [filterText, setFilterText] = useState('');

  // Drop the selection whenever the view changes underneath it.
  //
  // `selectedPaths` is a Set of absolute paths and nothing reconciled it with
  // what the grid shows: clearSelection had exactly two callers — after a
  // successful delete, and a click on the background. So navigating, filtering,
  // switching peer or switching storage mode all left a selection referring to
  // items that were no longer on screen, while the toolbar still read
  // "N selected".
  //
  // That is destructive, not cosmetic: the Delete shortcut resolves the
  // selection against the whole tree, so a user who selected 12 files, filtered
  // to 1, and pressed Delete deleted all 12 — including 11 they could not see.
  useEffect(() => {
    clearSelection();
  }, [currentPath, filterText, storageMode, selectedPeerCid, clearSelection]);

  // A link to an item selects it, which opens the inspector -- once per link, so
  // clearing the selection afterwards is not undone by the next tree update.
  const missingItem: string | null = useLinkedItem(tree, currentPath, place.location.item, currentTreeKey, selectAll);

  // And clear the FILTER itself on those same context changes — everything the
  // comment above says about a stale selection is true of a stale filter, minus
  // the "N selected" readout that made the selection visible.
  //
  // The filter matches only the current directory's immediate children, so it
  // travelled with the user into folders where it matched nothing — and the
  // grid then rendered "This folder is empty. Drag files here or right-click to
  // create a folder" about a folder with files in it. The box is 32px wide in
  // the top-right corner, so there is nothing on screen to explain it.
  //
  // `currentPath` is deliberately absent from the selection effect's siblings
  // here: the filter belongs to the view, and every one of these changes the
  // view.
  useEffect(() => {
    setFilterText('');
  }, [currentPath, storageMode, selectedPeerCid]);

  const handleSortChange: (field: SortField, direction: SortDirection) => void = useCallback((field: SortField, direction: SortDirection): void => {
    setSortField(field);
    setSortDirection(direction);
  }, []);

  // "Info" and "Preview" are the inspector, which follows the selection.
  const inspect: (node: RevfsNode) => void = useCallback((node: RevfsNode): void => selectAll([node.path]), [selectAll]);

  const fileReader: WorkspaceFileReader = useMemo((): WorkspaceFileReader =>
    agentFileReader({
      pull: async (node: RevfsNode): Promise<void> => { await downloadFile(node.path); },
      readChunk: (node: RevfsNode, offset: bigint, maxLen: number): Promise<PulledChunk> => readPulledChunk(node.path, offset, maxLen),
    }), [downloadFile, readPulledChunk]);

  const handlers: ReturnType<typeof useFileManagerHandlers> = useFileManagerHandlers({
    mkdir, rmdir, removeFile, downloadFile, uploadFile, rename, move, copy, refresh,
    cut, copyToClipboard, clearClipboard, clearSelection, selectAll,
    currentTreeKey, hasPasteItems, clipboard, isCut,
    myCid, storageUsed, storageQuota, storageOffer, storageMode, selectedPeerCid,
    tree, currentPath, filterText, fileInputRef,
    chooseUploadTarget: uploadTarget.choose, setRevfsDisabledReason, setRevfsDisabledModalOpen,
    setAttemptedFileSize, setStorageLimitModalOpen, inspect,
    storageLabel, downloadHistory: revfsDownloadHistory, showFile: setShownFile,
  });

  return {
    myCid, registeredPeers, peersLoading, place, storage, peerRegistered, selectedPeerCid,
    storageMode,
    tree, loading, error,
    // Exposed so the error screen can offer a way out. It was already threaded
    // into the handlers; the screen that needs it had no route to it.
    refresh,
    storageUsed, storageQuota, storageLabel, storageName,
    currentPath, missingItem, fileReader,
    fileInputRef, takeUploadTarget: uploadTarget.take,
    storageLimitModalOpen, setStorageLimitModalOpen, attemptedFileSize,
    revfsDisabledModalOpen, setRevfsDisabledModalOpen, revfsDisabledReason,
    shownFile, setShownFile,
    sortField, sortDirection, filterText, setFilterText,
    handleSortChange,
    cutItemPaths, hasPasteItems, selectedPaths, selectItem, clearSelection, selectPaths: selectAll,
    storageOffer, pendingPaths,
    ...handlers,
  };
}
