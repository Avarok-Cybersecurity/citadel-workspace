/**
 * Asking the server whether a peer is trusted, failing closed.
 *
 * Auto-accepting a registration, or sending one unprompted, rests on the SERVER's answer about
 * stored policy and membership, never on this client's roster. So anything short of a clear
 * answer — no session, a different session, no username, a refusal, silence — reads as "not
 * trusted", which leaves the person to decide: the same direction as the auto-accept setting.
 */
import { debugLog } from '@/lib/debug-config';
import type { PeerTrust } from '@/lib/workspace-service/messaging-trust-operations';
import type { MessagingTrustApi } from './messaging-trust-api';

/** How long to wait for the answer before asking the person instead. */
export const PEER_TRUST_TIMEOUT_MS: number = 8_000;

export const UNTRUSTED: PeerTrust = { trusted: false, peerTrustsCaller: false };

export async function askPeerTrust(
  api: Pick<MessagingTrustApi, 'checkPeer' | 'sessionCid'>,
  sessionCid: bigint,
  peerUsername: string | undefined,
): Promise<PeerTrust> {
  // Asked as another session, the answer would be about someone else's trust.
  if (!peerUsername || api.sessionCid() !== sessionCid) return UNTRUSTED;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const silence: Promise<PeerTrust> = new Promise<PeerTrust>((resolve: (value: PeerTrust) => void): void => {
    timer = setTimeout((): void => resolve(UNTRUSTED), PEER_TRUST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([api.checkPeer(peerUsername), silence]);
  } catch (error) {
    debugLog('MessagingTrust', `Trust check for ${peerUsername} failed; asking instead`, error);
    return UNTRUSTED;
  } finally {
    clearTimeout(timer);
  }
}
