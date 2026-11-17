import type { InternalServiceRequest } from 'citadel-workspace-client-ts';
import { peerRegistrationStore } from '@/lib/peer-registration-store';
import type { OutgoingPeerRequest } from '@/lib/peer-registration-store/types';
import { websocketService } from '@/lib/websocket-service';
import { getDefaultSecuritySettings } from '@/lib/security-utils';
import { toGeneratedSecuritySettings } from '@/lib/p2p-registration-service/constants';
import { debugLog } from '@/lib/debug-config';

export type PeerRegisterRequest = Extract<InternalServiceRequest, { PeerRegister: unknown }>;

/**
 * The PeerRegister request. Built here and nowhere else
 * (`__tests__/peer-register-has-one-builder.test.ts`): five copies had drifted
 * -- string CIDs in one, a request that was never recorded in another.
 *
 * `connect_after_register` is false on every path: the UI dials the peer itself
 * once they have answered (auto-connect), and an agent-side connect would race it.
 */
export function peerRegisterRequest(requestId: string, ownCid: bigint, peerCid: bigint): PeerRegisterRequest {
  return {
    PeerRegister: {
      request_id: requestId,
      cid: ownCid,
      peer_cid: peerCid,
      session_security_settings: toGeneratedSecuritySettings(getDefaultSecuritySettings()),
      connect_after_register: false,
      peer_session_password: null,
    },
  };
}

/**
 * Send it through the tab's own route: a follower proxies via the leader, and
 * either way the answer is routed back to this tab by its request id.
 */
export async function sendPeerRegisterRequest(requestId: string, ownCid: bigint, peerCid: bigint): Promise<void> {
  await websocketService.sendMessage(peerRegisterRequest(requestId, ownCid, peerCid));
}

/**
 * Resend a recorded request under its original id, as the session that made it.
 *
 * Straight to the client rather than through `sendMessage`: only the leader's
 * poll resends, and `sendMessage` would register the id to the leader tab, so
 * the answer to a follower's request would stop reaching the follower that
 * made it. Unregistered, it is routed by the session it names.
 */
export async function resendPeerRegistration(request: OutgoingPeerRequest): Promise<void> {
  const client: ReturnType<typeof websocketService.getClient> = websocketService.getClient();
  if (!client) throw new Error('No WebSocket client available');

  await websocketService.claimSession(request.fromCid);
  await client.sendDirectToInternalService(peerRegisterRequest(request.id, request.fromCid, request.toCid));
  debugLog('SendPeerRegistration', 'Resent PeerRegister to', request.peerUsername);
}

/**
 * Send a peer registration request, and record it so it can be resent.
 *
 * Extracted from the peer-discovery modal's hook because the User Directory had
 * a SECOND, entirely inert path to the same action: it called
 * `connectionService.sendRegistrationRequest`, which pushed the request into an
 * in-memory array and scheduled a demo simulation. Nothing touched the socket,
 * and the user was shown "Request Sent — connection request sent to X". X never
 * received anything, ever.
 *
 * Two entry points for one action, one of them real. This is the real one, and
 * now it is the only one.
 *
 * Returns the request id so the caller can correlate a later failure, and
 * whether the registration store recorded it -- a recorded request's refusal is
 * announced by `PeerRefusalNotice`, so the caller need not say it again.
 */
export interface SentPeerRegistration {
  readonly requestId: string;
  readonly recorded: boolean;
}

export async function sendPeerRegistration(
  ownCid: bigint,
  peerCid: bigint,
  peerUsername: string,
  /**
   * Supplied when the caller has already registered the id for correlation --
   * the discovery modal broadcasts it and records it before sending, so a
   * failure arriving early can still be matched to the peer it was about.
   */
  existingRequestId?: string,
): Promise<SentPeerRegistration> {
  const requestId: string = existingRequestId ?? crypto.randomUUID();
  const now: number = Date.now();

  // Recorded BEFORE the send. A failure notification can arrive before the
  // send's own promise resolves, and a request that failed is still a request
  // the user made — it belongs in the outgoing list either way.
  //
  // BUT THE BOOKKEEPING MAY NOT CANCEL THE ACTION.
  //
  // `addOutgoingRequest` writes the whole outgoing list, and the store refuses
  // that write when the key was never successfully read — correctly, because
  // writing an in-memory list over a key it never read would erase requests it
  // does not know about. That refusal is a throw, and it was awaited here,
  // before the send. So a storage read that failed at startup meant the
  // PeerRegister was NEVER SENT, and the user was told:
  //
  //   Request Failed — Refusing to write outgoing:
  //   'outgoing_peer_requests_…' was never successfully read
  //
  // Measured against the live deployment: the peer's agent logged no
  // `[PeerRegister]` at all, and the browser sent no frame but its own
  // GetSessions polls. Two users on a real server could not connect.
  //
  // Losing the record costs the resend-on-poll for this request. Not sending it
  // costs the request. The send is what the user asked for, so it happens
  // either way and the failure is reported rather than swallowed.
  let recorded: boolean = true;
  try {
    await peerRegistrationStore.addOutgoingRequest({
      id: requestId,
      fromCid: ownCid,
      toCid: peerCid,
      peerUsername,
      timestamp: now,
      timeLastSent: now,
    });
  } catch (error) {
    recorded = false;
    debugLog(
      'SendPeerRegistration',
      'Could not record the outgoing request; sending anyway',
      error,
    );
  }

  await sendPeerRegisterRequest(requestId, ownCid, peerCid);

  if (!recorded) {
    // Said out loud rather than left implicit: without the record the poll
    // loop will not resend this request if it goes unanswered.
    debugLog(
      'SendPeerRegistration',
      `Sent ${requestId} to ${peerUsername} without recording it; it will not be resent automatically`,
    );
  }

  return { requestId, recorded };
}
