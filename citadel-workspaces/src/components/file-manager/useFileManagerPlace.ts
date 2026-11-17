/**
 * Where the file manager is, read from the address and written back to it.
 *
 * Peer, mode and folder were three `useState`s, so none of them could be linked
 * to, Back in the browser did nothing inside the file manager, and the peer was
 * chosen by an effect that took the first registered one. Now the address is the
 * one source: opening a folder pushes a history entry, switching storage pushes
 * one and starts at the top, and filter and sort stay local to the view.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import {
  parseFileManagerLocation, resolveStorage, fileManagerHref,
  type FileManagerLocation, type FileManagerTarget, type StorageRef,
} from '@/lib/file-manager-location';
import { parentPath } from '@/lib/revfs/tree-queries';
import { visitFolder, goBack, type VisitedFolders } from './visited-folders';

export type OpenableStorage = FileManagerTarget['storage'];

export interface FileManagerPlace {
  location: FileManagerLocation;
  /** The storage this viewer means; see resolveStorage. */
  storage: StorageRef;
  path: string;
  openFolder: (path: string) => void;
  /** Opens a file in its app (Citadel Docs): the address names the file, Back returns to its folder. */
  openFile: (path: string) => void;
  openStorage: (storage: OpenableStorage) => void;
  /** Null when there is no folder to go back to, or nothing above. */
  back: (() => void) | null;
  up: (() => void) | null;
  /** Where a folder, or an item in it, is: what a link to it names. Null for unreadable storage. */
  locate: (path: string, item: string | null) => FileManagerTarget | null;
}

function storageKey(storage: StorageRef): string {
  if (storage.kind === 'peer') return `peer:${storage.cid.toString()}`;
  return storage.kind === 'server' ? 'server' : `invalid:${storage.raw}`;
}

export function useFileManagerPlace(myCid: bigint | null): FileManagerPlace {
  const routerLocation: ReturnType<typeof useLocation> = useLocation();
  const navigate: NavigateFunction = useNavigate();
  const location: FileManagerLocation = useMemo(
    (): FileManagerLocation => parseFileManagerLocation(new URLSearchParams(routerLocation.search)),
    [routerLocation.search],
  );
  const storage: StorageRef = useMemo((): StorageRef => resolveStorage(location, myCid), [location, myCid]);
  const key: string = storageKey(storage);

  const [visited, setVisited] = useState<VisitedFolders>([]);
  const visitedFor: MutableRefObject<string> = useRef(key);
  useEffect((): void => {
    if (visitedFor.current === key) return;
    visitedFor.current = key;
    setVisited([]);
  }, [key]);

  const go: (target: FileManagerTarget) => void = useCallback((target: FileManagerTarget): void => {
    navigate(fileManagerHref(routerLocation.search, target));
  }, [navigate, routerLocation.search]);

  const openable: OpenableStorage | null = storage.kind === 'invalid' ? null : storage;
  const path: string = location.path;

  // A folder or a file: either way the address names it and a history entry is pushed.
  const openPath: (to: string) => void = useCallback((to: string): void => {
    if (openable === null) return;
    setVisited((v: VisitedFolders): VisitedFolders => visitFolder(v, path, to));
    go({ storage: openable, path: to, item: null, via: null });
  }, [go, openable, path]);

  const openStorage: (next: OpenableStorage) => void = useCallback((next: OpenableStorage): void => {
    go({ storage: next, path: '/', item: null, via: null });
  }, [go]);

  const previous: { visited: VisitedFolders; to: string } | null = goBack(visited);
  const back: (() => void) | null = previous === null || openable === null ? null : (): void => {
    setVisited(previous.visited);
    go({ storage: openable, path: previous.to, item: null, via: null });
  };
  const up: (() => void) | null = path === '/' ? null : (): void => openPath(parentPath(path));

  const locate: (at: string, item: string | null) => FileManagerTarget | null = useCallback((at: string, item: string | null): FileManagerTarget | null => (
    openable === null ? null : { storage: openable, path: at, item, via: openable.kind === 'peer' ? myCid : null }
  ), [openable, myCid]);

  return { location, storage, path, openFolder: openPath, openFile: openPath, openStorage, back, up, locate };
}
