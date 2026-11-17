/**
 * P2P Auto-Connect: registered peers via GetSessions
 *
 * The fallback used when ListRegisteredPeers times out. Moved verbatim out of
 * connection-logic.ts to keep that file under the 250-line limit.
 */

import { wireMapEntries } from '@/lib/wire-map';
import { p2pRegistrationService } from '../p2p-registration-service';
import { connectionManager } from '../connection';
import { debugLog } from '@/lib/debug-config';
import type { ActiveSession } from '@/types/session-types';

/** Fallback: Get registered peers from GetSessions response. */
export async function getRegisteredPeersViaGetSessions(currentCid: bigint): Promise<Array<{ cid: bigint; username: string }>> {
  try {
    const sessions: ActiveSession[] = await connectionManager.getActiveSessions();
    const mySession: ActiveSession | undefined = sessions.find(s => s.cid === currentCid);

    // Object.keys on a Map is always [], so this branch was always taken.
    const wirePeers: [string, { peer_username?: string; }][] = wireMapEntries<{ peer_username?: string }>(mySession?.peer_connections, 'peer_connections');
    if (wirePeers.length === 0) {
      debugLog('P2PAutoConnectService', 'P2PAutoConnect: No peer_connections in session, using local peer registry...');
      const { registeredPeers } = p2pRegistrationService.getPeers();
      return registeredPeers.map(p => ({ cid: p.cid, username: p.username }));
    }

    return wirePeers.map(([peerCidStr, peerInfo]) => ({
      cid: BigInt(peerCidStr),
      username: peerInfo.peer_username || '',
    }));
  } catch (error) {
    debugLog('P2PAutoConnectService', 'GetSessions fallback failed:', error);
    return [];
  }
}
