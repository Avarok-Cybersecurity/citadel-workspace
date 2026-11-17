/**
 * Broadcast Channel Service - Broadcasting
 *
 * Methods for broadcasting messages, workspace responses, state sync,
 * connection status, P2P messages, and leader election claims.
 */

import type { InternalServiceResponse } from 'citadel-workspace-client-ts';
import type { P2PNotificationData } from '@/types/ws-message-types';
import { debugLog } from '@/lib/debug-config';
import type { BroadcastMessage } from './types';

/**
 * Post a broadcast message to the channel.
 */
export function broadcast(
  channel: BroadcastChannel | null,
  message: BroadcastMessage
): void {
  if (!channel) return;
  try {
    channel.postMessage(message);
  } catch (error) {
    debugLog('BroadcastChannelService', 'Failed to broadcast message', error);
  }
}

export function broadcastWorkspaceResponse(
  channel: BroadcastChannel | null,
  tabId: string,
  isLeader: boolean,
  response: InternalServiceResponse
): void {
  if (!isLeader) {
    debugLog('BroadcastChannelService', 'Only the leader can broadcast workspace responses');
    return;
  }

  const responseType: string = Object.keys(response)[0];
  debugLog('BroadcastChannelService', `Broadcasting ${responseType} as workspace-response`);

  const responseRecord: Record<string, Record<string, unknown>> = response as Record<string, Record<string, unknown>>;
  const targetCid: bigint | undefined =
    (responseRecord.PeerConnectNotification?.cid as bigint | undefined) ||
    (responseRecord.PeerRegisterNotification?.cid as bigint | undefined) ||
    (responseRecord.MessageNotification?.cid as bigint | undefined);

  if (targetCid !== undefined) {
    debugLog('BroadcastChannelService', `P2P notification has targetCid=${targetCid.toString().slice(0, 8)}...`);
  }

  const message: BroadcastMessage = {
    type: 'workspace-response',
    data: response,
    targetCid,
    timestamp: Date.now(),
    tabId,
    isLeader: true
  };
  broadcast(channel, message);
}

/**
 * The session a state-sync is addressed to: the one the state is ABOUT when the sender
 * names it, else the sender tab's own.
 *
 * The leader broadcasts connection state for every tab's session, and followers drop
 * state-sync addressed to another session. Stamped with the leader's own session, a
 * follower signed in as somebody else discarded every update about its own connections
 * (seen live: its peer read "Offline" while the P2P link was up and a file crossed it).
 */
export function stateSyncTarget(about: bigint | undefined, senderSelected: bigint | undefined): bigint | undefined {
  return about ?? senderSelected;
}

/**
 * Build and broadcast a state-sync message.
 */
export function broadcastStateSync(
  channel: BroadcastChannel | null,
  tabId: string,
  isLeader: boolean,
  data: unknown,
  /**
   * The session this state belongs to. Without it every tab applies the leader's workspace,
   * including a tab signed in as somebody else — see handleStateSync. Optional so a sender
   * that genuinely has no session yet still broadcasts.
   */
  targetCid?: bigint,
): void {
  const message: BroadcastMessage = {
    type: 'state-sync',
    data,
    timestamp: Date.now(),
    tabId,
    isLeader,
    targetCid,
  };
  broadcast(channel, message);
}

/**
 * Build and broadcast a connection-status message.
 */
export function broadcastConnectionStatus(
  channel: BroadcastChannel | null,
  tabId: string,
  isLeader: boolean,
  status: { isConnected: boolean; cid?: bigint }
): void {
  const message: BroadcastMessage = {
    type: 'connection-status',
    data: status,
    timestamp: Date.now(),
    tabId,
    isLeader
  };
  broadcast(channel, message);
}


/**
 * Build and broadcast a P2P notification to follower tabs (leader only).
 */
export function broadcastP2PNotification(
  channel: BroadcastChannel | null,
  tabId: string,
  isLeader: boolean,
  data: { notification: P2PNotificationData; messageBytes: Uint8Array }
): void {
  if (!isLeader) {
    debugLog('BroadcastChannelService', '[BroadcastChannel] broadcastP2PNotification: Not leader, skipping');
    return;
  }

  const notificationCid: string = data.notification?.cid?.toString();
  const peerCid: string = data.notification?.peer_cid?.toString();

  debugLog('BroadcastChannelService', '[BroadcastChannel] Broadcasting P2P notification to followers:', {
    notificationCid: notificationCid?.slice(0, 12),
    peerCid: peerCid?.slice(0, 12),
    messageLength: data.notification?.message?.length || 0,
    hasMessageBytes: !!data.messageBytes,
    tabId
  });

  const message: BroadcastMessage = {
    type: 'p2p-notification',
    data,
    timestamp: Date.now(),
    tabId,
    isLeader: true
  };
  broadcast(channel, message);
}
