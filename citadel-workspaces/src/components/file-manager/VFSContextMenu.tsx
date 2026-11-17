/**
 * The three right-click menus: a file, a folder, and the empty canvas.
 *
 * File: Preview, Open in Citadel Docs (a file it reads), Download, Share, Rename, Move to, Copy link, Delete.
 * Folder: Open, Share folder, Rename, Move to, Delete.
 * Canvas: New folder, Upload, Paste, Refresh.
 *
 * A key is shown beside an action only where the keyboard handler answers it
 * (vfs-shortcuts.ts), and Escape closes the menu (Radix). What a file's state
 * forbids is left out rather than offered and refused: the state predicates in
 * lib/revfs/file-states.ts decide, as the handlers do.
 */
import type { ReactNode } from 'react';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  ClipboardPaste, Download, Eye, FileText, FileUp, FolderInput, FolderOpen, FolderPlus, Link2, Pencil, RefreshCw, Share2, Trash2,
} from 'lucide-react';
import { RevfsFileState, type RevfsNode } from '@/types/revfs-types';
import { canDelete, canDownload, canModify } from './item-permissions';
import { docsOpenAction } from './docs-file-open';
import { VFS_SHORTCUTS, shortcutLabel, ariaShortcut, isApplePlatform, type VfsShortcut } from './vfs-shortcuts';
import type { VFSItemActions } from './vfs-item-actions';

interface VFSContextMenuProps {
  /** The item right-clicked, or null for the canvas. */
  node: RevfsNode | null;
  /** The open folder: where the canvas menu creates, uploads and pastes. */
  folder: string;
  actions: VFSItemActions;
  hasPasteItems: boolean;
  /** Rename is done in place, by the list or grid that owns the item. */
  onStartRename: (node: RevfsNode) => void;
  children: ReactNode;
}

const APPLE: boolean = typeof navigator !== 'undefined' && isApplePlatform(navigator);

function keys(s: VfsShortcut): { 'aria-keyshortcuts': string } {
  return { 'aria-keyshortcuts': ariaShortcut(s, APPLE) };
}
function Hint({ s }: { s: VfsShortcut }): JSX.Element {
  return <ContextMenuShortcut>{shortcutLabel(s, APPLE)}</ContextMenuShortcut>;
}

const ITEM: string = 'cursor-pointer';

function DeleteItem({ onSelect }: { onSelect: () => void }): JSX.Element {
  return (
    <ContextMenuItem onSelect={onSelect} data-testid="vfs-delete" {...keys(VFS_SHORTCUTS.remove)} className={`${ITEM} text-destructive-emphasis focus:text-destructive-emphasis`}>
      <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Delete<Hint s={VFS_SHORTCUTS.remove} />
    </ContextMenuItem>
  );
}

function FileItems({ node, actions, onStartRename }: { node: RevfsNode; actions: VFSItemActions; onStartRename: (n: RevfsNode) => void }): JSX.Element {
  const modifiable: boolean = canModify(node);
  const openInDocs: (() => void) | null = docsOpenAction(actions, node);
  return (
    <>
      <ContextMenuItem onSelect={() => actions.inspect(node)} {...keys(VFS_SHORTCUTS.preview)} className={ITEM}>
        <Eye className="mr-2 h-4 w-4" aria-hidden="true" />Preview<Hint s={VFS_SHORTCUTS.preview} />
      </ContextMenuItem>
      {openInDocs !== null && (
        <ContextMenuItem onSelect={openInDocs} data-testid="vfs-open-in-docs" className={ITEM}>
          <FileText className="mr-2 h-4 w-4" aria-hidden="true" />Open in Citadel Docs
        </ContextMenuItem>
      )}
      {canDownload(node) && (
        <ContextMenuItem onSelect={() => actions.download(node)} {...keys(VFS_SHORTCUTS.download)} className={ITEM}>
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />
          {node.fileState === RevfsFileState.Received ? 'Open' : 'Download'}
          <Hint s={VFS_SHORTCUTS.download} />
        </ContextMenuItem>
      )}
      <ContextMenuItem onSelect={() => actions.share([node])} className={ITEM} data-testid="vfs-share">
        <Share2 className="mr-2 h-4 w-4" aria-hidden="true" />Share…
      </ContextMenuItem>
      <ContextMenuSeparator />
      {modifiable && (
        <>
          <ContextMenuItem onSelect={() => onStartRename(node)} {...keys(VFS_SHORTCUTS.rename)} className={ITEM}>
            <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />Rename<Hint s={VFS_SHORTCUTS.rename} />
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => actions.moveTo([node])} className={ITEM}>
            <FolderInput className="mr-2 h-4 w-4" aria-hidden="true" />Move to…
          </ContextMenuItem>
        </>
      )}
      <ContextMenuItem onSelect={() => actions.copyLink(node)} className={ITEM}>
        <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />Copy link
      </ContextMenuItem>
      {canDelete(node) && (<><ContextMenuSeparator /><DeleteItem onSelect={() => actions.remove([node])} /></>)}
    </>
  );
}

function FolderItems({ node, actions, onStartRename }: { node: RevfsNode; actions: VFSItemActions; onStartRename: (n: RevfsNode) => void }): JSX.Element {
  const modifiable: boolean = canModify(node);
  return (
    <>
      <ContextMenuItem onSelect={() => actions.openFolder(node.path)} className={ITEM}>
        <FolderOpen className="mr-2 h-4 w-4" aria-hidden="true" />Open
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => actions.share([node])} className={ITEM} data-testid="vfs-share">
        <Share2 className="mr-2 h-4 w-4" aria-hidden="true" />Share folder
      </ContextMenuItem>
      {modifiable && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onStartRename(node)} {...keys(VFS_SHORTCUTS.rename)} className={ITEM}>
            <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />Rename<Hint s={VFS_SHORTCUTS.rename} />
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => actions.moveTo([node])} className={ITEM}>
            <FolderInput className="mr-2 h-4 w-4" aria-hidden="true" />Move to…
          </ContextMenuItem>
          <ContextMenuSeparator />
          <DeleteItem onSelect={() => actions.remove([node])} />
        </>
      )}
    </>
  );
}

function CanvasItems({ folder, actions, hasPasteItems }: { folder: string; actions: VFSItemActions; hasPasteItems: boolean }): JSX.Element {
  return (
    <>
      <ContextMenuItem onSelect={() => actions.newFolder(folder)} className={ITEM}>
        <FolderPlus className="mr-2 h-4 w-4" aria-hidden="true" />New folder
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => actions.upload(folder)} className={ITEM}>
        <FileUp className="mr-2 h-4 w-4" aria-hidden="true" />Upload files
      </ContextMenuItem>
      {hasPasteItems && (
        <ContextMenuItem onSelect={() => { void actions.paste(folder); }} {...keys(VFS_SHORTCUTS.paste)} className={ITEM}>
          <ClipboardPaste className="mr-2 h-4 w-4" aria-hidden="true" />Paste<Hint s={VFS_SHORTCUTS.paste} />
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={actions.refresh} className={ITEM}>
        <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Refresh
      </ContextMenuItem>
    </>
  );
}

export function VFSContextMenu({ node, folder, actions, hasPasteItems, onStartRename, children }: VFSContextMenuProps): JSX.Element {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      {/* A right-opening menu cannot shift sideways, and a long-press mid-row on a phone leaves no side
          wide enough for 224px: it is capped at the room Radix measures, so it never runs off the screen. */}
      <ContextMenuContent className="w-56 max-w-[var(--radix-context-menu-content-available-width)]" collisionPadding={8}>
        {node === null && <CanvasItems folder={folder} actions={actions} hasPasteItems={hasPasteItems} />}
        {node?.type === 'directory' && <FolderItems node={node} actions={actions} onStartRename={onStartRename} />}
        {node?.type === 'file' && <FileItems node={node} actions={actions} onStartRename={onStartRename} />}
      </ContextMenuContent>
    </ContextMenu>
  );
}
