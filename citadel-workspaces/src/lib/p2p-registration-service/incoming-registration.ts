/**
 * The real effects behind `handleIncomingRegistration` (incoming-request-policy.ts).
 *
 * Moved out of connection.ts, which was over the 250-line cap, when the
 * stranger policy was added in front of the auto-accept branch it used to be.
 */
import { peerRegistrationStore } from '../peer-registration-store';
import { sendRegistrationDecline } from '../peer-registration-store/lifecycle';
import { getPrivacySettings } from '@/lib/privacy-settings';
import { messagingTrustApi } from '@/lib/messaging-trust/messaging-trust-api';
import { askPeerTrust } from '@/lib/messaging-trust/peer-trust';
import type { PeerTrust } from '@/lib/workspace-service/messaging-trust-operations';
import { debugLog } from '@/lib/debug-config';
import type { Peer, PendingRequestEntry } from './types';
import { acceptRegistrationRequest, getAutoAcceptSetting } from './connection';
import {
  handleIncomingRegistration,
  type IncomingRegistration,
  type IncomingRequestAction,
} from './incoming-request-policy';

/**
 * Handle incoming registration - uses notification's cid (recipient) instead of getCurrentCid().
 */
export async function handleIncomingRegistrationWithCid(
  notificationCid: bigint,
  peerCid: bigint,
  peerUsername: string | undefined,
  pendingRequests: Map<string, PendingRequestEntry>,
  registeredPeers: Map<bigint, Peer>,
): Promise<void> {
  const action: IncomingRequestAction = await handleIncomingRegistration(
    { recipientCid: notificationCid, peerCid, peerUsername },
    {
      trustedByWorkspace: async (r: IncomingRegistration): Promise<boolean> => {
        const answer: PeerTrust = await askPeerTrust(messagingTrustApi, r.recipientCid, r.peerUsername);
        return answer.trusted;
      },
      acceptsRequestsFromStrangers: (): boolean => getPrivacySettings().acceptRequestsFromStrangers,
      isContact: (peer: bigint): boolean => registeredPeers.has(peer),
      weAskedThemFirst: (peer: bigint, cid: bigint): boolean => peerRegistrationStore.hasOutgoingRequestTo(peer, cid),
      readAutoAccept: getAutoAcceptSetting,
      accept: (r: IncomingRegistration): Promise<void> => acceptRegistrationRequest(r.peerCid, r.peerUsername, pendingRequests),
      ask: (r: IncomingRegistration): Promise<void> => peerRegistrationStore.handleIncomingRequest({
        cid: r.recipientCid, peer_cid: r.peerCid, peer_username: r.peerUsername,
      }),
      decline: (r: IncomingRegistration): Promise<void> => sendRegistrationDecline(r.recipientCid, r.peerCid),
    },
  );
  debugLog('P2PRegistrationService', `[P2P] Registration from ${peerUsername || peerCid.toString()} for ${notificationCid.toString()}: ${action}`);
}
