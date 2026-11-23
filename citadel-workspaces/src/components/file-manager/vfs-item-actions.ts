/**
 * Everything that can be done to an item, a selection or the open folder.
 *
 * One bundle, built once in FileManagerContent and handed to the list, the grid,
 * the menus, the inspector and the bulk bar. They each took a dozen loose
 * callbacks before, and a menu entry whose callback a parent forgot to pass was
 * an item that silently did nothing.
 */
import type { RevfsNode } from '@/types/revfs-types';
import type { FileOpener, Openers } from '@/lib/citadel-apps/openers/openers';

export interface VFSItemActions {
  openFolder: (path: string) => void;
  /** A file's open action (file-openers' activateFile): its app, else fetch it, or show where a received one already is. */
  openFile: (node: RevfsNode) => void;
  /** The apps that open the item here, preferred first; null where no app could read its bytes. */
  openersOf: (node: RevfsNode) => Openers | null;
  /** Open the file in `app` (one of `openersOf(node)`). */
  openIn: (app: FileOpener, node: RevfsNode) => void;
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
