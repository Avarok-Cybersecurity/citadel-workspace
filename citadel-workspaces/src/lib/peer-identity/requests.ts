/**
 * The two peer-identity requests a window sends: read the pair's fingerprints, and accept the
 * changed key the person was shown. Accepting is only ever this request, sent from the person's
 * own click; nothing here accepts on its own.
 */
import { requestResponse } from '../websocket/request-response';
import { TIMEOUT } from '../timeout-constants';
import { answerTo as answer, conversationSender, type RequestSender } from '../agent-conversations/sender';
import { peerIdentityViewOf, type PeerIdentityView } from './wire';
import type { PeerIdentityInfo, PeerIdentityKeyAccepted } from 'citadel-internal-service-wasm-client';

async function ask<T>(variant: string, body: Record<string, unknown>, success: string, read: (answer: Record<string, unknown>) => T): Promise<T> {
  const send: RequestSender | null = conversationSender();
  if (!send) throw new Error(`${variant}: the websocket service is not ready`);
  const requestId: string = crypto.randomUUID();
  return requestResponse<T>({
    request: { [variant]: { request_id: requestId, ...body } },
    requestId,
    sendRequest: (request: unknown, id?: string): Promise<void> => send(request as Record<string, unknown>, id),
    timeoutMs: TIMEOUT.SERVER_REQUEST_MS,
    operationName: variant,
    matcher: {
      matchSuccess: (message: Record<string, unknown>): T | undefined => {
        const found: Record<string, unknown> | undefined = answer(message, success, requestId);
        return found ? read(found) : undefined;
      },
      matchFailure: (message: Record<string, unknown>): string | undefined => {
        const failed: Record<string, unknown> | undefined = answer(message, 'PeerIdentityFailure', requestId);
        return failed ? String(failed.message ?? `${variant} failed`) : undefined;
      },
    },
  });
}

export function getPeerIdentity(cid: bigint, peerCid: bigint): Promise<PeerIdentityView> {
  return ask('GetPeerIdentity', { cid, peer_cid: peerCid }, 'PeerIdentity',
    (found: Record<string, unknown>): PeerIdentityView => peerIdentityViewOf(found as unknown as PeerIdentityInfo));
}

/** Pins the key whose fingerprint the person accepted; resolves with the fingerprint now pinned. */
export function acceptPeerIdentityKey(cid: bigint, peerCid: bigint, fingerprint: string): Promise<string> {
  return ask('AcceptPeerIdentityKey', { cid, peer_cid: peerCid, fingerprint }, 'PeerIdentityKeyAccepted',
    (found: Record<string, unknown>): string => String((found as unknown as PeerIdentityKeyAccepted).fingerprint));
}
