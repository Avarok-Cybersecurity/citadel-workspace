/**
 * Peer Registration Store - Event Handlers
 *
 * WebSocket message routing and session/leader event handling.
 * Extracted from service.ts to keep the orchestrator under 250 lines.
 */

import { eventEmitter } from '../event-emitter';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { isAlreadyRegistered } from './already-registered';
import { debugLog } from '@/lib/debug-config';
import { narrowWebSocketMessage, hasVariant, getVariant } from '@/lib/ws-message-boundary';
import type { KVPendingEntry } from './types';
import type { WebSocketMessage } from '@/types/ws-message-types';
import {
  resolveKVResponse,
  resolveKVSetSuccess,
  rejectKVFailure,
} from './persistence';

/** Callbacks the event handlers need from the store */
export interface StoreCallbacks {
  refreshNotificationsForCurrentSession: () => Promise<void>;
  startPollLoop: () => void;
  stopPollLoop: () => void;
  removeOutgoingRequestByPeer: (peerCid: bigint) => Promise<void>;
  removeOutgoingRequest: (requestId: string) => Promise<{ peerUsername: string } | null>;
  removeRequestByPeerCid: (peerCid: bigint) => Promise<void>;
  isInitialized: () => boolean;
  getPendingKVRequests: () => Map<string, KVPendingEntry>;
}

/**
 * Register all event listeners for the store.
 * Called once during construction.
 */
export function setupEventListeners(callbacks: StoreCallbacks): void {
  eventEmitter.on('session-selected', () => {
    debugLog('PeerRegistrationStore', 'Session switched, refreshing notifications');
    setTimeout(() => {
      runAsyncSetup(async () => { await callbacks.refreshNotificationsForCurrentSession(); });
    }, 100);
  });

  eventEmitter.on('instance:leader-changed', (data: { isLeader: boolean; leaderId: string }) => {
    debugLog('PeerRegistrationStore', `Leader changed - isLeader: ${data.isLeader}`);
    if (data.isLeader) { if (callbacks.isInitialized()) callbacks.startPollLoop(); }
    else { callbacks.stopPollLoop(); }
  });

  eventEmitter.on('websocket-message', (raw: unknown) => {
    handleWebSocketMessage(raw, callbacks);
  });
}

function handleWebSocketMessage(raw: unknown, callbacks: StoreCallbacks): void {
  const message: WebSocketMessage | null = narrowWebSocketMessage(raw);
  if (!message) return;

  const kv: Map<string, KVPendingEntry> = callbacks.getPendingKVRequests();

  if (hasVariant(message, 'LocalDBSetKVSuccess')) {
    const { request_id } = getVariant(message, 'LocalDBSetKVSuccess')!;
    resolveKVSetSuccess(kv, request_id as string);
  }

  if (hasVariant(message, 'LocalDBGetKVSuccess')) {
    const v: Record<string, unknown> = getVariant(message, 'LocalDBGetKVSuccess')!;
    resolveKVResponse(kv, v.request_id as string, v.value as number[] | undefined);
  }

  if (hasVariant(message, 'LocalDBSetKVFailure') || hasVariant(message, 'LocalDBGetKVFailure')) {
    const failure: Record<string, unknown> = ((message as Record<string, unknown>).LocalDBSetKVFailure ||
      (message as Record<string, unknown>).LocalDBGetKVFailure) as Record<string, unknown>;
    rejectKVFailure(kv, failure.request_id as string, failure.message as string);
  }

  handlePeerRegistrationEvents(message, callbacks);
}

function handlePeerRegistrationEvents(
  message: NonNullable<ReturnType<typeof narrowWebSocketMessage>>,
  callbacks: StoreCallbacks
): void {
  if (hasVariant(message, 'PeerRegisterSuccess')) {
    const v: Record<string, unknown> = getVariant(message, 'PeerRegisterSuccess')!;
    const peer_cid: bigint | undefined = v.peer_cid as bigint | undefined;
    debugLog('PeerRegistrationStore', 'PeerRegisterSuccess received', {
      request_id: v.request_id,
      cid: (v.cid as bigint | undefined)?.toString(),
      peer_cid: peer_cid?.toString()
    });
    if (peer_cid !== undefined) {
      callbacks.removeOutgoingRequestByPeer(peer_cid).catch(
        (err: unknown) => debugLog('PeerRegistrationStore', 'removeOutgoingRequestByPeer failed:', err)
      );
    }
  }

  if (hasVariant(message, 'PeerRegisterFailure')) {
    const v: Record<string, unknown> = getVariant(message, 'PeerRegisterFailure')!;
    // Correlated by request_id, NOT by peer_cid. This branch used to read
    // `v.peer_cid` and act only when it was defined -- and PeerRegisterFailure
    // has no peer_cid: the generated binding is `{ cid, message, request_id }`.
    // So the cleanup never ran once, and a refused request stayed in the
    // outgoing list forever, with `hasOutgoingRequestTo` still answering true,
    // which is what the UI reads to decide a request is still in flight. The
    // user could neither see it resolve nor ask again.
    //
    // `OutgoingPeerRequest.id` is the id that was sent, so this correlation was
    // available all along -- `usePeerDiscovery` beside it already used it.
    const requestId: string | undefined =
      typeof v.request_id === 'string' ? v.request_id : undefined;
    const reason: string | undefined = typeof v.message === 'string' ? v.message : undefined;
    debugLog('PeerRegistrationStore', 'PeerRegisterFailure received', {
      request_id: v.request_id,
      cid: (v.cid as bigint | undefined)?.toString(),
      errorMsg: v.message,
    });
    // No id names no request. Clearing "the" outgoing request without knowing
    // which would drop somebody else's, which is worse than leaving this stuck.
    // See already-registered.ts. Clearing the outgoing record is right -- the
    // request IS resolved -- but announcing a REFUSAL for it puts "your request
    // was refused" on screen for a peer who is registered.
    if (requestId !== undefined && isAlreadyRegistered(reason)) {
      debugLog('PeerRegistrationStore', 'Already registered - clearing the outgoing request as resolved', { requestId });
      callbacks.removeOutgoingRequest(requestId).catch(
        (err: unknown) => debugLog('PeerRegistrationStore', 'removeOutgoingRequest failed:', err),
      );
    } else if (requestId !== undefined) {
      // Emitted rather than toasted: this is library code. The only other
      // handler lives in usePeerDiscovery, which can say nothing once the
      // discovery modal has closed -- and a refusal usually arrives long after.
      // The removed record carries the peer's name, which is the whole point of
      // saying anything at all.
      callbacks.removeOutgoingRequest(requestId).then(
        (removed: { peerUsername: string } | null) => {
          eventEmitter.emit('peer-registration:refused', {
            requestId, reason, peerUsername: removed?.peerUsername,
          });
        },
        (err: unknown) => debugLog('PeerRegistrationStore', 'removeOutgoingRequest failed:', err),
      );
    }
  }

  if (hasVariant(message, 'PeerConnectSuccess')) {
    const v: Record<string, unknown> = getVariant(message, 'PeerConnectSuccess')!;
    const peer_cid: bigint | undefined = v.peer_cid as bigint | undefined;
    if (peer_cid !== undefined) {
      debugLog('PeerRegistrationStore', `Clearing requests for connected peer ${peer_cid.toString()}`);
      callbacks.removeRequestByPeerCid(peer_cid).catch(
        (err: unknown) => debugLog('PeerRegistrationStore', 'removeRequestByPeerCid failed:', err)
      );
      callbacks.removeOutgoingRequestByPeer(peer_cid).catch(
        (err: unknown) => debugLog('PeerRegistrationStore', 'removeOutgoingRequestByPeer failed:', err)
      );
      eventEmitter.emit('peer-requests:updated');
    }
  }
}
