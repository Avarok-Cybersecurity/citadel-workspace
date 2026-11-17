import { eventEmitter } from '@/lib/event-emitter';
import { p2pAutoConnectService } from '@/lib/p2p-auto-connect-service';
import { debugLog } from '@/lib/debug-config';

/**
 * What happens once WE have accepted a peer's request, however the accept was
 * made: by the user's click (`peer-registration-store/lifecycle.ts`) or by
 * policy (`p2p-registration-service/connection.ts`).
 *
 * The two had drifted. The click dialled the peer and said nothing; the policy
 * announced the accept and did not dial, relying on `PeerRegisterSuccess` ->
 * `p2p:peer-registered` -> auto-connect alone. Both sides of a registration get
 * that success from the agent (`requests/peer/register.rs`, with
 * `connect_after_register` false), so the event path dials on either side; the
 * explicit dial here is the one that survived the "already registered" accept
 * which once skipped it and left no channel open (accept-matcher.ts). It cannot
 * double-dial: `connectToPeer` records the pending dial synchronously and skips
 * a second while one is in flight or the link is up.
 */
export function afterPeerAccepted(peerCid: bigint, peerUsername: string | undefined): void {
  eventEmitter.emit('p2p:registration-accepted', { peerCid, peerUsername });
  p2pAutoConnectService.connectToPeer(peerCid).catch((err: unknown): void => {
    debugLog('AfterPeerAccepted', 'Connecting after the accept failed:', err);
  });
}
