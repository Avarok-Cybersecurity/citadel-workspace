/**
 * P2P Auto-Connect Event Handlers
 *
 * Sets up all event listeners for the auto-connect service.
 * Events drive the single source of truth for peer connections.
 */

import { eventEmitter } from '../event-emitter';
import { p2pRegistrationService } from '../p2p-registration-service';
import { instanceManager } from '../multi-instance';
import { debugLog, warnLog } from '@/lib/debug-config';
import { narrowWebSocketMessage, hasVariant, getVariant } from '@/lib/ws-message-boundary';
import type { BroadcastStateSyncData, WebSocketMessage } from '@/types/ws-message-types';
import type { AutoConnectState } from './state';
import { getCurrentCid } from './cid-resolver';
import { connectToPeer, handleConnectionSuccess, handlePeerDisconnect } from './connection-logic';
import { handleIncomingPeerConnect, offerAdmitted, type IncomingOffer } from './incoming-connect';
import { incomingAnswer, linkAdmitted } from './pause-gate';
import { installPollingLifecycle } from './polling-lifecycle';
import { parsePeerPathReport } from '@/lib/ice-servers/path';
import type { PeerPathReport } from '@/types/ice-servers';
import { installFollowerSnapshots } from './follower-snapshot';
import { installPathChanges } from './path-changes';
import { LEADER_WIRE_EVENT } from '@/lib/websocket/leader-inbound-handler';

/** Callback type for setPeerConnected (broadcasts to followers) */
type BroadcastPeerConnected = (localCid: bigint, peerCid: bigint) => void;

/**
 * Set up all event listeners for the P2P auto-connect service.
 * @param state - The shared AutoConnectState
 * @param broadcastPeerConnected - Callback to set peer connected with broadcast
 * @param connectAll - Callback to connect to all registered peers
 */
export function setupEventListeners(
  state: AutoConnectState,
  broadcastPeerConnected: BroadcastPeerConnected,
  connectAll: () => Promise<void>
): void {
  installPollingLifecycle(state, connectAll);

  installFollowerSnapshots({
    on: (event: string, handler: (payload: unknown) => void): void => { eventEmitter.on(event, handler); },
    isLeader: (): boolean => instanceManager.isLeader,
    selfInstanceId: (): string => instanceManager.instanceId,
    peersFor: (localCid: bigint): bigint[] => state.getPeersForSession(localCid),
    announce: broadcastPeerConnected,
  });

  // Follower tab connectedPeers sync
  eventEmitter.on('broadcast-state-sync', (raw: unknown) => {
    const data: BroadcastStateSyncData = raw as BroadcastStateSyncData;
    if (data?.type === 'connected-peers-update' && !instanceManager.isLeader) {
      const localCid: string | undefined = data.localCid as string | undefined;
      const peerCid: string | undefined = data.peerCid as string | undefined;
      if (localCid !== undefined && peerCid !== undefined) {
        const localCidBigInt: bigint = BigInt(localCid);
        const peerCidBigInt: bigint = BigInt(peerCid);
        debugLog('P2PAutoConnectService', `Follower received connectedPeers update: ${localCidBigInt.toString().slice(0, 8)}... <-> ${peerCidBigInt.toString().slice(0, 8)}...`);
        state.setPeerConnectedLocal(localCidBigInt, peerCidBigInt);
        // Followers never see the PeerConnectSuccess (it is routed to the
        // leader, which issued the request), so the path rides along here.
        const route: PeerPathReport | null = parsePeerPathReport(data.route);
        if (route !== null) state.core.setConnectionPath(localCidBigInt, peerCidBigInt, route);
        // `{ peerCid }` alone, as the other three emitters of this event
        // already send: every consumer destructures only peerCid.
        eventEmitter.emit('p2p-connection-established', { peerCid: peerCidBigInt });
      }
    }
  });

  // Immediate connect on peer registration
  eventEmitter.on('p2p:peer-registered', ({ peer, isIncoming }: { peer: { cid?: bigint }; isIncoming?: boolean; isOutgoing?: boolean }) => {
    const peerCid: bigint | undefined = peer?.cid;
    if (peerCid === undefined) return;

    if (isIncoming) {
      const weRegisteredFirst: boolean = p2pRegistrationService.hasOutgoingRegistration(peerCid);
      if (weRegisteredFirst) {
        state.addOnlinePeer(peerCid);
        debugLog('P2PAutoConnectService', `P2PAutoConnect: Mutual registration complete with ${peerCid.toString().slice(0, 8)}..., initiating immediate connection`);
        connectToPeer(state, peerCid).catch((err) => {
          debugLog('P2PAutoConnectService', `Failed to connect after mutual registration ${peerCid.toString().slice(0, 8)}...:`, err);
        });
      } else {
        debugLog('P2PAutoConnectService', `P2PAutoConnect: Incoming registration from ${peerCid.toString().slice(0, 8)}..., waiting for user to accept`);
      }
      return;
    }

    state.addOnlinePeer(peerCid);
    debugLog('P2PAutoConnectService', `P2PAutoConnect: Outgoing registration to ${peerCid.toString().slice(0, 8)}... confirmed, initiating immediate connection`);
    connectToPeer(state, peerCid).catch((err) => {
      debugLog('P2PAutoConnectService', `Failed to connect to newly registered peer ${peerCid.toString().slice(0, 8)}...:`, err);
    });
  });

  // When WE accept, the accept itself dials (lib/p2p/after-peer-accepted.ts); nothing to do here.
  eventEmitter.on('p2p:registration-accepted', ({ peerCid }: { peerCid: bigint }) => {
    if (peerCid !== undefined) {
      debugLog('P2PAutoConnectService', `P2PAutoConnect: Registration accepted for ${peerCid.toString().slice(0, 8)}... - waiting for initiator to connect`);
    }
  });

  installPathChanges({ bus: eventEmitter, isLeader: (): boolean => instanceManager.isLeader, wireEvent: LEADER_WIRE_EVENT, core: state.core });

  // WebSocket message handler for P2P connect/disconnect events
  setupWebSocketMessageHandler(state, broadcastPeerConnected);
}

/**
 * Handle WebSocket messages for P2P connect/disconnect events.
 * Separated for readability.
 */
function setupWebSocketMessageHandler(
  state: AutoConnectState,
  broadcastPeerConnected: BroadcastPeerConnected
): void {
  eventEmitter.on('websocket-message', async (raw: unknown) => {
    const message: WebSocketMessage | null = narrowWebSocketMessage(raw);
    if (!message) return;

    if (hasVariant(message, 'PeerConnectSuccess')) {
      await handlePeerConnectSuccess(state, message, broadcastPeerConnected);
    }

    if (hasVariant(message, 'PeerConnectNotification')) {
      const notification: Record<string, unknown> = getVariant(message, 'PeerConnectNotification')!;
      if (instanceManager.isLeader) {
        const targetCid: bigint | undefined = notification.cid as bigint | undefined;
        const initiatorCid: bigint | undefined = notification.peer_cid as bigint | undefined;
        // Not for a paused contact, nor an offer below the target chat's level: the owning
        // tab declines those (incoming-connect), so they will not connect.
        if (targetCid !== undefined && initiatorCid !== undefined) {
          void Promise.all([incomingAnswer(targetCid, initiatorCid), offerAdmitted(targetCid, initiatorCid, notification as IncomingOffer)])
            .then(([answer, admitted]: [Awaited<ReturnType<typeof incomingAnswer>>, boolean]): void => {
              if (answer !== 'accept' || !admitted) return;
              debugLog('P2PAutoConnectService', `Leader updating connectedPeers for target CID ${targetCid.toString().slice(0, 8)}... -> peer ${initiatorCid.toString().slice(0, 8)}...`);
              broadcastPeerConnected(targetCid, initiatorCid);
            }, (err: unknown): void => warnLog('P2PAutoConnectService', 'offer admission check failed:', err));
        }
      }
      handleIncomingPeerConnect(
        state,
        notification as IncomingOffer,
        broadcastPeerConnected
      ).catch((err) => {
        debugLog('P2PAutoConnectService', 'handleIncomingPeerConnect failed:', err);
      });
    }

    if (hasVariant(message, 'PeerDisconnect')) {
      await handleDisconnectVariant(state, message, 'PeerDisconnect');
    }

    if (hasVariant(message, 'DisconnectNotification')) {
      const v: Record<string, unknown> = getVariant(message, 'DisconnectNotification')!;
      if (v.peer_cid) {
        await handleDisconnectVariant(state, message, 'DisconnectNotification');
      }
    }
  });
}

async function handlePeerConnectSuccess(
  state: AutoConnectState,
  message: WebSocketMessage,
  broadcastPeerConnected: BroadcastPeerConnected
): Promise<void> {
  const v: Record<string, unknown> = getVariant(message, 'PeerConnectSuccess')!;
  const messageCid: bigint | undefined = v.cid as bigint | undefined;
  const peerCid: bigint | undefined = v.peer_cid as bigint | undefined;

  // The path at delivery (both sides), normally the relay while `upgrading`; the link is
  // usable now and path-changes keeps it current. An older agent omits it: nothing is
  // recorded. Recorded BEFORE the broadcast below, which carries it to the followers.
  const route: PeerPathReport | null = parsePeerPathReport(v);
  if (route !== null && messageCid !== undefined && peerCid !== undefined) {
    state.core.setConnectionPath(messageCid, peerCid, route);
  }
  // A paused pair is neither marked connected nor left up; see pause-gate.
  if (messageCid !== undefined && peerCid !== undefined && !(await linkAdmitted(messageCid, peerCid))) return;
  if (instanceManager.isLeader && messageCid !== undefined && peerCid !== undefined) {
    debugLog('P2PAutoConnectService', `Leader updating connectedPeers for initiator CID ${messageCid.toString().slice(0, 8)}... -> peer ${peerCid.toString().slice(0, 8)}...`);
    broadcastPeerConnected(messageCid, peerCid);
  }

  const currentCid: bigint | null = await getCurrentCid();
  if (messageCid !== undefined && currentCid && messageCid !== currentCid) return;

  if (peerCid !== undefined && peerCid !== currentCid && currentCid) {
    handleConnectionSuccess(state, currentCid, peerCid, broadcastPeerConnected);
  }
}

async function handleDisconnectVariant(
  state: AutoConnectState,
  message: WebSocketMessage,
  variant: 'PeerDisconnect' | 'DisconnectNotification'
): Promise<void> {
  const v: Record<string, unknown> = getVariant(message, variant)!;
  const messageCid: bigint | undefined = v.cid as bigint | undefined;
  const peerCid: bigint | undefined = v.peer_cid as bigint | undefined;

  if (instanceManager.isLeader && messageCid !== undefined && peerCid !== undefined) {
    debugLog('P2PAutoConnectService', `Leader ${variant}: removing peer ${peerCid.toString().slice(0, 8)}... from CID ${messageCid.toString().slice(0, 8)}...`);
    state.setPeerDisconnected(messageCid, peerCid);
  }

  const currentCid: bigint | null = await getCurrentCid();
  if (messageCid !== undefined && currentCid && messageCid !== currentCid) return;

  if (peerCid !== undefined && currentCid) {
    if (variant === 'DisconnectNotification') {
      debugLog('P2PAutoConnectService', `[P2PAutoConnect] DisconnectNotification: Peer ${peerCid.toString().slice(0, 8)}... session disconnected`);
    }
    handlePeerDisconnect(state, currentCid, peerCid);
  }
}
