/**
 * Whether an inbound direct message is from a stranger the user refuses.
 *
 * See a-strangers-message-is-not-shown.test.ts for why the agent is asked
 * before anything is hidden, and why an unanswerable ask shows the message.
 */
import { getPrivacySettings } from '@/lib/privacy-settings';
import { p2pRegistrationService } from '../p2p-registration-service';
import type { PeerInfoResponse } from '../p2p-registration-service/types';

export interface StrangerGateDeps {
  acceptsRequestsFromStrangers: () => boolean;
  /** Registered or connected, as far as this tab knows. */
  isKnownContact: (peerCid: bigint) => boolean;
  /** The agent's own answer; null when it could not be asked. */
  agentSaysRegistered: (peerCid: bigint) => Promise<boolean | null>;
}

export async function isHiddenAsStranger(peerCid: bigint, deps: StrangerGateDeps): Promise<boolean> {
  if (deps.acceptsRequestsFromStrangers()) return false;
  if (deps.isKnownContact(peerCid)) return false;
  return (await deps.agentSaysRegistered(peerCid)) === false;
}

/**
 * The production answers: the privacy setting, this tab's registry (or a live
 * connection, which only a mutual registration can have), and the agent's list.
 */
export function productionStrangerGate(isConnected: (peerCid: bigint) => boolean): StrangerGateDeps {
  return {
    acceptsRequestsFromStrangers: (): boolean => getPrivacySettings().acceptRequestsFromStrangers,
    isKnownContact: (peerCid: bigint): boolean =>
      isConnected(peerCid) || p2pRegistrationService.isPeerRegistered(peerCid),
    agentSaysRegistered: async (peerCid: bigint): Promise<boolean | null> => {
      try {
        const listed: PeerInfoResponse[] = await p2pRegistrationService.listRegisteredPeers();
        return listed.some((p: PeerInfoResponse) => p.cid === peerCid);
      } catch {
        return null;
      }
    },
  };
}
