/**
 * Which screen the file manager shows, decided in one place.
 *
 * The storage comes from the address (see lib/file-manager-location.ts), not
 * from "the first registered peer", so the question is no longer whether there
 * is a peer to pick but whether the one the address names can be opened:
 *
 * - an id that is not a CID, your own CID, or a CID that is not one of your
 *   registered peers is `unknown-peer`, said as such -- never quietly replaced
 *   by some other member's storage or the server's;
 * - while the peer list is still loading, an unlisted CID is `finding-peers`,
 *   not yet unknown: a registered, online peer used to read as none here.
 */
import type { StorageRef } from '@/lib/file-manager-location';

export type FileManagerScreen = 'connecting' | 'finding-peers' | 'unknown-peer' | 'loading' | 'error' | 'browser';

export interface FileManagerScreenInputs {
  myCid: bigint | null;
  storage: StorageRef;
  peersLoading: boolean;
  /** Whether `storage` is a peer you are registered with. */
  peerRegistered: boolean;
  treeLoading: boolean;
  hasError: boolean;
  hasTree: boolean;
}

export function fileManagerScreen(i: FileManagerScreenInputs): FileManagerScreen {
  if (!i.myCid) return 'connecting';
  if (i.storage.kind === 'invalid') return 'unknown-peer';
  if (i.storage.kind === 'peer') {
    if (i.storage.cid === i.myCid) return 'unknown-peer';
    if (!i.peerRegistered) return i.peersLoading ? 'finding-peers' : 'unknown-peer';
  }
  if (i.treeLoading) return 'loading';
  if (i.hasError || !i.hasTree) return 'error';
  return 'browser';
}
