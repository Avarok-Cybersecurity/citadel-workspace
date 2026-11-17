import { instanceManager } from '@/lib/multi-instance';
import { broadcastChannelService } from '@/lib/broadcast-channel-service';
import { debugLog } from '@/lib/debug-config';

/**
 * Broadcast peer update to follower tabs if we are the leader, addressed to the session it is about.
 *
 * `ownerCid` is the response's or notification's `cid`: the session that registered, or was
 * registered with. Unaddressed, broadcastStateSync stamped the LEADER tab's session, so a
 * follower signed in as someone else dropped every update about its own registrations —
 * the defect stateSyncTarget (broadcasting.ts) fixed for connected-peers-update.
 */
export function broadcastPeerUpdate(ownerCid: unknown, peerCid: bigint, username: string, flags: { isOutgoing?: boolean; isIncoming?: boolean }): void {
  if (!instanceManager.isLeader) return;
  if (typeof ownerCid !== 'bigint') {
    debugLog('P2PRegistrationService', `[P2P-SYNC] Not broadcasting ${peerCid.toString().slice(0, 8)}...: the answer names no session`);
    return;
  }
  debugLog('P2PRegistrationService', `[P2P-SYNC] Leader broadcasting registeredPeers update: ${peerCid.toString().slice(0, 8)}...`);
  broadcastChannelService.broadcastStateSync({
    type: 'registered-peer-update', peerCid: peerCid.toString(), peerUsername: username, ...flags,
  }, ownerCid);
}
