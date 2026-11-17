/**
 * Everything that can be done to an item, a selection or the open folder.
 *
 * One bundle, built once in FileManagerContent and handed to the list, the grid,
 * the menus, the inspector and the bulk bar. They each took a dozen loose
 * callbacks before, and a menu entry whose callback a parent forgot to pass was
 * an item that silently did nothing.
 */
import type { RevfsNode } from '@/types/revfs-types';

export interface VFSItemActions {
  openFolder: (path: string) => void;
  /** A file's open action: Citadel Docs for a file it reads, else fetch it, or show where a received one already is. */
  openFile: (node: RevfsNode) => void;
  /** Open the file in Citadel Docs (offered per item through docs-file-open's docsOpenAction). */
  openInDocs: (node: RevfsNode) => void;
  /** Put it in the inspector. */
  inspect: (node: RevfsNode) => void;
  download: (node: RevfsNode) => void;
  share: (nodes: RevfsNode[]) => void;
  moveTo: (nodes: RevfsNode[]) => void;
  copyLink: (node: RevfsNode) => void;
  remove: (nodes: RevfsNode[]) => void;
  rename: (path: string, newName: string) => Promise<void>;
  cut: (nodes: RevfsNode[]) => void;
  copy: (nodes: RevfsNode[]) => void;
  paste: (destination: string) => Promise<void>;
  newFolder: (parent: string) => void;
  upload: (folder: string) => void;
  refresh: () => void;
  drop: (target: string, files: FileList) => void;
}
