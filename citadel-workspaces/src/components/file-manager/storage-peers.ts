/**
 * The peers whose shared storage the file manager can browse.
 *
 * `useRegisteredPeers` is the one peer list the app shows; it carries CIDs as
 * strings for display. The file manager keys trees by bigint, so the CID is
 * parsed once here, and a row whose CID does not parse is dropped rather than
 * turned into peer zero. The connection state rides along for the status strip's
 * "N peers connected" and the picker's dots.
 */
import type { RegisteredPeer } from '@/hooks/use-registered-peers';

export interface StoragePeer {
  cid: bigint;
  username: string;
  displayName: string;
  isOnline: RegisteredPeer['isOnline'];
  isConnected: RegisteredPeer['isConnected'];
  connectionPath: RegisteredPeer['connectionPath'];
}

export function storagePeersFrom(peers: RegisteredPeer[]): StoragePeer[] {
  const out: StoragePeer[] = [];
  for (const peer of peers) {
    if (!/^\d+$/.test(peer.cid) || peer.cid === '0') continue;
    out.push({
      cid: BigInt(peer.cid), username: peer.username, displayName: peer.displayName,
      isOnline: peer.isOnline, isConnected: peer.isConnected, connectionPath: peer.connectionPath,
    });
  }
  return out;
}

/** How many of them the agent reports a live connection to. Unknown is not connected. */
export function connectedCount(peers: readonly StoragePeer[]): number {
  return peers.filter((p: StoragePeer): boolean => p.isConnected === true).length;
}
