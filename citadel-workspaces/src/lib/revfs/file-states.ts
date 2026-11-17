/**
 * RE-VFS file-state predicates and flips (pure functions).
 *
 * Split out of tree-queries.ts, which was over the 250-line cap. These read a
 * node's `fileState` rather than walking paths, so they stand on their own.
 */

import { type RevfsNode, RevfsFileState } from '@/types/revfs-types';

// ============================================================================
// Flip File States (for incoming remote operations)
// ============================================================================

/**
 * Can this file's bytes actually be fetched by the viewer?
 *
 * Single source of truth for a predicate that was written out by hand at each
 * use site. It is the predicate the Hosted/Remote inversion broke: an uploader
 * was stamped Hosted, which fails this, so their own file was permanently
 * un-downloadable while the toast told them it was "encrypted, cannot open".
 */
export function isDownloadableState(state: RevfsFileState | undefined): boolean {
  return (
    state === RevfsFileState.Remote ||
    state === RevfsFileState.Received ||
    state === RevfsFileState.ServerStored
  );
}

/**
 * Can the viewer delete this file's stored bytes? Everything that is stored somewhere
 * -- for them by a peer or the server, or by them for a peer. Sent and Received are
 * local records of a transfer, not stored objects. Beside isDownloadableState for the
 * same reason: the menu's hand-written list left ServerStored out of both.
 */
export function isDeletableState(state: RevfsFileState | undefined): boolean {
  return (
    state === RevfsFileState.Remote ||
    state === RevfsFileState.Hosted ||
    state === RevfsFileState.ServerStored
  );
}

export function flipFileState(state: RevfsFileState): RevfsFileState {
  switch (state) {
    case RevfsFileState.Hosted: return RevfsFileState.Remote;
    case RevfsFileState.Remote: return RevfsFileState.Hosted;
    default: return state; // Sent/Received stay as-is
  }
}

export function flipNodeStates(node: RevfsNode): RevfsNode {
  const flipped: RevfsNode = { ...node };
  if (flipped.fileState) {
    flipped.fileState = flipFileState(flipped.fileState);
  }
  if (flipped.children) {
    flipped.children = flipped.children.map(flipNodeStates);
  }
  return flipped;
}
