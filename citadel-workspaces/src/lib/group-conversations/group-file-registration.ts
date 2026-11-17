/**
 * Which members are P2P-registered with the sender, for a group file share.
 *
 * The first version asked `p2pRegistrationService.isPeerRegistered`, which
 * reads the service's in-memory `registeredPeers` map. That map is filled by
 * session sync, registration events and follower broadcasts -- NOT by the
 * `ListRegisteredPeers` answer the sidebar and the direct chat render from. So
 * a peer the sidebar showed as registered, online and connected was skipped as
 * "not connected with you over P2P", measured live, and every re-share said the
 * same.
 *
 * The agent's listing is the authority, asked once per share, unioned with the
 * cache (a registration moments old may not be listed yet). When the listing
 * cannot be had the answer is "unknown" for anyone the cache lacks, and unknown
 * is attempted: the send either reaches them or fails with its own reason.
 */
import type { PeerInfoResponse } from '@/lib/p2p-registration-service/types';
import { debugLog } from '@/lib/debug-config';

/** True, false, or null when the agent could not be asked. */
export type RegistrationLookup = (cid: bigint) => boolean | null;

export async function registrationLookup(
  cached: readonly bigint[],
  listRegistered: () => Promise<PeerInfoResponse[]>,
): Promise<RegistrationLookup> {
  const known: Set<bigint> = new Set<bigint>(cached);
  try {
    const listed: PeerInfoResponse[] = await listRegistered();
    for (const peer of listed) {
      if (peer.cid !== undefined) known.add(BigInt(peer.cid));
    }
    return (cid: bigint): boolean => known.has(cid);
  } catch (error) {
    debugLog('GroupFileShare', 'Could not list registered peers; attempting every member not in the cache', error);
    return (cid: bigint): boolean | null => (known.has(cid) ? true : null);
  }
}
