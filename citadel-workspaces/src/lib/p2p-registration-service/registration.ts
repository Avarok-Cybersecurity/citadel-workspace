/**
 * P2P Registration Service - Registration State Machine
 *
 * Handles WebSocket message routing for registration responses/notifications,
 * peer registration execution, and batch registration of unregistered peers.
 */

import { isPlaceholderName, peerDisplayName } from '@/lib/peer-display';
import { sendPeerRegisterRequest } from '@/lib/p2p/send-peer-registration';
import { failOnSocketLoss } from '../websocket/request-response';
import { broadcastChannelService } from '../broadcast-channel-service';
import { debugLog } from '@/lib/debug-config';
import { isForThisSession } from '@/lib/sessions/notification-ownership';
import type { WebSocketMessage } from '@/types/ws-message-types';
import { eventEmitter } from '../event-emitter';
import type { Peer, PendingRequestEntry } from './types';
import { CONCURRENT_REGISTRATIONS, PEER_REGISTER_TIMEOUT_MS } from './constants';
import { getCurrentCid } from './discovery';
import { consumeWasDecline } from './decline-correlation';
import { broadcastPeerUpdate } from './broadcast-peer-update';
import { isAlreadyRegistered } from '../peer-registration-store/already-registered';

/** Context passed from the service so the message handler can read/write shared state. */
export interface RegistrationContext {
  pendingRequests: Map<string, PendingRequestEntry>;
  allPeers: Map<bigint, Peer>;
  registeredPeers: Map<bigint, Peer>;
  outgoingRegistrations: Set<bigint>;
  incomingRegistrations: Set<bigint>;
  handleIncomingRegistration: (notificationCid: bigint, peerCid: bigint, peerUsername?: string) => Promise<void>;
}

/** Route an incoming WebSocket message to the appropriate handler. */
export function handleWebSocketMessage(message: WebSocketMessage, ctx: RegistrationContext): void {
  const msg: Record<string, Record<string, unknown> | undefined> = message as Record<string, Record<string, unknown> | undefined>;
  if (msg.ListAllPeersResponse) {
    resolveRequest(ctx.pendingRequests, msg.ListAllPeersResponse.request_id as string, msg.ListAllPeersResponse);
  } else if (msg.ListAllPeersFailure) {
    rejectRequest(ctx.pendingRequests, msg.ListAllPeersFailure.request_id as string,
      (msg.ListAllPeersFailure.message as string) || 'Failed to list peers');
  } else if (msg.ListRegisteredPeersResponse) {
    resolveRequest(ctx.pendingRequests, msg.ListRegisteredPeersResponse.request_id as string, msg.ListRegisteredPeersResponse);
  } else if (msg.ListRegisteredPeersFailure) {
    rejectRequest(ctx.pendingRequests, msg.ListRegisteredPeersFailure.request_id as string,
      (msg.ListRegisteredPeersFailure.message as string) || 'Failed to list registered peers');
  } else if (msg.PeerRegisterSuccess) {
    handlePeerRegisterSuccess(msg.PeerRegisterSuccess, ctx);
  } else if (msg.PeerRegisterFailure) {
    handlePeerRegisterFailure(msg.PeerRegisterFailure, ctx);
  } else if (msg.PeerRegisterNotification) {
    handlePeerRegisterNotification(msg.PeerRegisterNotification, ctx);
  }
}

function resolveRequest(pending: Map<string, PendingRequestEntry>, requestId: string, data: Record<string, unknown>): void {
  const entry: PendingRequestEntry | undefined = pending.get(requestId);
  if (entry) { entry.resolve(data); pending.delete(requestId); }
}

function rejectRequest(pending: Map<string, PendingRequestEntry>, requestId: string, errorMsg: string): void {
  const entry: PendingRequestEntry | undefined = pending.get(requestId);
  if (entry) { entry.reject(new Error(errorMsg)); pending.delete(requestId); }
}

/** Ensure a peer exists in context maps and mark as registered. Returns the peer. */
function ensurePeerRegistered(ctx: RegistrationContext, peerCid: bigint, peerUsername?: string): Peer {
  const fallbackName: string = peerDisplayName({ cid: peerCid, username: peerUsername });
  const peer: Peer = ctx.allPeers.get(peerCid) || {
    cid: peerCid, username: fallbackName, fullName: fallbackName, isOnline: true, isRegistered: true
  };
  peer.isRegistered = true;
  // A real name replaces a placeholder, never the other way round: this runs on
  // every registration event, and the later ones do not always carry the name.
  if (peerUsername !== undefined && !isPlaceholderName(peerUsername) && isPlaceholderName(peer.username)) {
    peer.username = peerUsername;
    peer.fullName = peerUsername;
  }
  ctx.registeredPeers.set(peerCid, peer);
  if (!ctx.allPeers.has(peerCid)) ctx.allPeers.set(peerCid, peer);
  return peer;
}

function handlePeerRegisterSuccess(data: Record<string, unknown>, ctx: RegistrationContext): void {
  resolveRequest(ctx.pendingRequests, data.request_id as string, data);

  // A declined request is answered with this same response: the decline was
  // delivered, which is a success from the service's side. Running the
  // registration path here marked the declined peer as registered, put them in
  // registeredPeers and broadcast that to the other tabs.
  if (consumeWasDecline(data.request_id as string)) {
    debugLog('P2PRegistrationService', '[P2P] Decline delivered; not registering the peer');
    return;
  }

  const peerCid: bigint | undefined = data.peer_cid as bigint | undefined;
  const peerUsername: string | undefined = data.peer_username as string | undefined;
  if (peerCid !== undefined) {
    ctx.outgoingRegistrations.add(peerCid);
    const peer: Peer = ensurePeerRegistered(ctx, peerCid, peerUsername);
    eventEmitter.emit('p2p:peer-registered', { peer, isOutgoing: true });
    broadcastPeerUpdate(data.cid, peerCid, peer.username, { isOutgoing: true });
  }
}

function handlePeerRegisterFailure(data: Record<string, unknown>, ctx: RegistrationContext): void {
  const requestId: string = data.request_id as string;
  const errorMsg: string = (data.message as string) || 'Failed to register peer';
  const peerCid: bigint | undefined = data.peer_cid as bigint | undefined;

  if (isAlreadyRegistered(errorMsg)) {
    debugLog('P2PRegistrationService', `[P2P] Peer ${peerCid?.toString()} already registered - treating as success`);
    if (peerCid !== undefined) {
      ctx.outgoingRegistrations.add(peerCid);
      const peer: Peer = ensurePeerRegistered(ctx, peerCid);
      eventEmitter.emit('p2p:peer-registered', { peer, isOutgoing: true, wasAlreadyRegistered: true });
      broadcastPeerUpdate(data.cid, peerCid, peer.username, { isOutgoing: true });
    }
    resolveRequest(ctx.pendingRequests, requestId, { peer_cid: peerCid, already_registered: true });
  } else {
    rejectRequest(ctx.pendingRequests, requestId, errorMsg);
  }
}

function handlePeerRegisterNotification(data: Record<string, unknown>, ctx: RegistrationContext): void {
  const notificationCid: bigint | undefined = data.cid as bigint | undefined;
  const peerCid: bigint | undefined = data.peer_cid as bigint | undefined;
  const peerUsername: string | undefined = data.peer_username as string | undefined;
  debugLog('P2PRegistrationService', '[P2P] Peer registered with us:', {
    cid: notificationCid?.toString(), peer_cid: peerCid?.toString(),
    peer_username: peerUsername, request_id: data.request_id
  });

  if (peerCid !== undefined && notificationCid !== undefined) {

    const fallbackName: string = peerUsername || 'Unknown';
    const peer: Peer = ctx.allPeers.get(peerCid) || {
      cid: peerCid, username: fallbackName, fullName: peerUsername || 'Unknown User',
      isOnline: true, isRegistered: false
    };
    // NOT marked registered, and NOT added to `registeredPeers`.
    //
    // This notification is an incoming *request*. The backend defines registered
    // as mutual — `list_registered` answers from `GetMutuals` — so recording it
    // here claimed a relationship that does not exist until the user accepts.
    //
    // It was not cosmetic: `MessageSender` checks `isPeerRegistered` and skips
    // registration when it is true, so a first message to someone whose request
    // was merely pending went out against a peer with no mutual registration and
    // no ratchet, and failed. The peer also appeared among the user's
    // connections before they had agreed to anything.
    //
    // `allPeers` still learns the name, so the request renders with a username
    // rather than a bare CID, and `handleIncomingRegistration` below still runs
    // the pending-request flow. Auto-connect's mutual detection keys off
    // `hasOutgoingRegistration`, not this map, so it is unaffected.
    ctx.allPeers.set(peerCid, peer);
    eventEmitter.emit('p2p:peer-registered', { peer, isIncoming: true });
    broadcastPeerUpdate(notificationCid, peerCid, peer.username, { isIncoming: true });
    // Addressed to THIS tab's session, or not ours to act on.
    //
    // The router has three documented paths that deliver a notification to a
    // tab that does not own its cid (the 2s orphan buffer, the un-acked
    // forward fallback, and a stale instance registry). Without this, a
    // registration request for account B landing here made account A accept
    // it -- registering A with the stranger who asked for B, under A's own
    // cid, while B never saw the request at all.
    //
    // `p2p-auto-connect-service/incoming-connect.ts` already made exactly this
    // check and it was never propagated here. See
    // lib/sessions/notification-ownership.ts.
    void (async (): Promise<void> => {
      const ourCid: bigint | null = await getCurrentCid();
      if (!isForThisSession(notificationCid, ourCid)) {
        debugLog('P2PRegistrationService', `Ignoring PeerRegisterNotification for session ${String(notificationCid)}; this tab is ${String(ourCid)}`);
        return;
      }
      await ctx.handleIncomingRegistration(notificationCid, peerCid, peerUsername);
    })().catch(error => {
      debugLog('P2PRegistrationService', 'Failed to handle incoming registration:', error);
    });
  }
  eventEmitter.emit('p2p:peer-registered-with-us', { peerCid, peerUsername });
}

/** Register a specific peer via PeerRegister request. */
export async function registerPeer(
  peerCid: bigint, pendingRequests: Map<string, PendingRequestEntry>
): Promise<void> {
  const currentCid: bigint | null = await getCurrentCid();
  if (!currentCid || currentCid === 0n) throw new Error('No active user session (CID 0 is service connection)');
  if (peerCid === currentCid) throw new Error('Cannot register with self');

  const requestId: string = crypto.randomUUID();
  broadcastChannelService.registerRequest(requestId, currentCid);
  const responsePromise: Promise<Record<string, unknown>> = new Promise<Record<string, unknown>>((resolve, reject): void => {
    pendingRequests.set(requestId, { resolve, reject });
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        broadcastChannelService.clearRequest(requestId);
        reject(new Error('PeerRegister request timed out'));
      }
    }, PEER_REGISTER_TIMEOUT_MS);
  });
  await sendPeerRegisterRequest(requestId, currentCid, peerCid);
  await failOnSocketLoss('PeerRegister', responsePromise);
  debugLog('P2PRegistrationService', `Successfully registered peer ${peerCid}`);
}

/** Register all unregistered peers in batches. */
export async function registerUnregisteredPeers(
  allPeers: Map<bigint, Peer>, pendingRequests: Map<string, PendingRequestEntry>
): Promise<void> {
  const unregistered: Peer[] = Array.from(allPeers.values()).filter(p => !p.isRegistered);
  if (unregistered.length === 0) return;
  debugLog('P2PRegistrationService', `Found ${unregistered.length} unregistered peers, registering...`);
  for (let i: number = 0; i < unregistered.length; i += CONCURRENT_REGISTRATIONS) {
    const batch: Peer[] = unregistered.slice(i, i + CONCURRENT_REGISTRATIONS);
    await Promise.all(batch.map(peer =>
      registerPeer(peer.cid, pendingRequests).catch(error => {
        debugLog('P2PRegistrationService', `Failed to register peer ${peer.cid}:`, error);
      })
    ));
  }
}
