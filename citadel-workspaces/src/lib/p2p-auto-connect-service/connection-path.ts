/**
 * A session's reported path to a peer, for the peer lists and the chat header.
 * Separate from the service index so it loads with the sidebar, not the landing page.
 */
import { p2pAutoConnectService } from './index';
import type { PeerConnectPath, PeerPathReport } from '@/types/ice-servers';

/** The agent's latest report for this session's connection to `peerCid`; null when unknown. */
export function connectionRouteFor(sessionCid: bigint | null, peerCid: bigint): PeerPathReport | null {
  if (sessionCid === null) return null;
  return p2pAutoConnectService.getPeerConnectionInfo(sessionCid, peerCid)?.route ?? null;
}

/** How this session's connection to `peerCid` travels now; null when unknown. */
export function connectionPathFor(sessionCid: bigint | null, peerCid: bigint): PeerConnectPath | null {
  return connectionRouteFor(sessionCid, peerCid)?.path ?? null;
}
