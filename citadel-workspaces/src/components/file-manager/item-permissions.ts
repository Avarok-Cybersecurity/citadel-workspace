/**
 * What may be done to an item, from its state and place. One answer for the
 * menus, the inspector, the bulk bar and the keyboard, which each spelled their
 * own list before and disagreed about ServerStored.
 */
import { PROTECTED_DIRS, RevfsFileState, type RevfsNode } from '@/types/revfs-types';
import { isDeletableState, isDownloadableState } from '@/lib/revfs/file-states';

/** Whether a file's bytes can be fetched: stored for you, or the peer's to send on request. */
export function canDownload(node: RevfsNode): boolean {
  return node.type === 'file' && (isDownloadableState(node.fileState) || node.fileState === RevfsFileState.Hosted);
}

/** Whether an item may be renamed, moved or deleted at all: the seeded folders are fixed. */
export function canModify(node: RevfsNode): boolean {
  return node.path !== '/' && !PROTECTED_DIRS.has(node.path);
}

export function canDelete(node: RevfsNode): boolean {
  return canModify(node) && (node.type === 'directory' || isDeletableState(node.fileState));
}
