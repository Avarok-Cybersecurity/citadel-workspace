/**
 * The workspace peers the agent lists, looked up by username or by CID.
 *
 * A member is known by USERNAME and a conversation by CID; this listing is the one source that
 * carries both for people who are not yet contacts, so opening a chat with a colleague, and the
 * presence readers, all look here.
 */
import { p2pRegistrationService, type Peer } from './p2p-registration-service';

export function workspacePeerNamed(username: string): Peer | undefined {
  return p2pRegistrationService.getPeers().allPeers.find((peer: Peer): boolean => peer.username === username);
}

export function workspacePeerWithCid(cid: bigint): Peer | undefined {
  return p2pRegistrationService.getPeers().allPeers.find((peer: Peer): boolean => peer.cid === cid);
}

/**
 * Ask the agent for its listing now. The listing is polled every 30s, so a colleague who has just
 * come online can be listed by the agent and still missing here; clicking their row then said
 * they were unreachable until the next round.
 */
export function refreshWorkspacePeers(): Promise<void> {
  return p2pRegistrationService.refreshPeers();
}
