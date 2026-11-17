/**
 * Adding to and removing from the outgoing-request list.
 *
 * Extracted from service.ts at the repo's 250-line cap. The three mutators are
 * one shape — change the list, persist it, broadcast it — and getting any of
 * those three steps wrong shows up the same way: a request the UI still thinks
 * is in flight. Keeping them together makes that shape checkable in one place
 * rather than three.
 *
 * The list and the KV map stay owned by the store; these take them as a
 * context, so nothing here holds state of its own.
 */
import { debugLog } from '@/lib/debug-config';
import { persistOutgoingToLocalDB } from './persistence';
import { removeOutgoingById, removeOutgoingByPeerCid, hasOutgoingRequestTo } from './state';
import type { OutgoingPeerRequest, KVPendingEntry } from './types';

export interface OutgoingContext {
  requests: OutgoingPeerRequest[];
  kv: Map<string, KVPendingEntry>;
  /** Replaces the store's list; the mutators here never reassign it directly. */
  setRequests: (next: OutgoingPeerRequest[]) => void;
  broadcast: () => Promise<void>;
}

export async function addOutgoing(ctx: OutgoingContext, request: OutgoingPeerRequest): Promise<void> {
  if (!request.toCid) { debugLog('PeerRegistrationStore', 'Cannot add outgoing request without toCid'); return; }
  if (!request.fromCid) { debugLog('PeerRegistrationStore', 'Cannot add outgoing request without fromCid'); return; }
  if (hasOutgoingRequestTo(ctx.requests, request.toCid, request.fromCid)) {
    debugLog('PeerRegistrationStore', 'Duplicate outgoing request to', request.toCid);
    return;
  }
  if (!request.timeLastSent) request.timeLastSent = request.timestamp || Date.now();
  ctx.requests.push(request);
  debugLog('PeerRegistrationStore', 'Added outgoing request', request);
  await persistOutgoingToLocalDB(ctx.requests, ctx.kv);
  await ctx.broadcast();
}

/**
 * Returns the request that was removed, so a caller can name the peer it was
 * about. A refusal notice that says "your request was declined" without saying
 * whose is not worth showing, and this record is the only place the username
 * still exists once the request is gone.
 */
export async function removeOutgoing(
  ctx: OutgoingContext, requestId: string,
): Promise<OutgoingPeerRequest | null> {
  const removed: OutgoingPeerRequest | undefined = ctx.requests.find((r) => r.id === requestId);
  const next: OutgoingPeerRequest[] = removeOutgoingById(ctx.requests, requestId);
  if (next.length === ctx.requests.length) return null;

  ctx.setRequests(next);
  debugLog('PeerRegistrationStore', 'Removed outgoing request', requestId);
  await persistOutgoingToLocalDB(next, ctx.kv);
  await ctx.broadcast();
  return removed ?? null;
}

export async function removeOutgoingForPeer(
  ctx: OutgoingContext, peerCid: bigint, fromCid?: bigint,
): Promise<void> {
  const next: OutgoingPeerRequest[] = removeOutgoingByPeerCid(ctx.requests, peerCid, fromCid);
  if (next.length === ctx.requests.length) return;

  ctx.setRequests(next);
  debugLog('PeerRegistrationStore', 'Removed outgoing request to peer', peerCid.toString());
  await persistOutgoingToLocalDB(next, ctx.kv);
  await ctx.broadcast();
}
