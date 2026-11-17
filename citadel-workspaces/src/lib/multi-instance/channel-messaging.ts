/**
 * Channel Messaging
 *
 * Message handlers for non-election messages: outbound requests, ACKs,
 * inbound forwards, instance announce/goodbye, session release, CID update.
 */

import { eventEmitter } from '../event-emitter';
import { instanceManager } from './instance-manager';
import { outboundQueue } from './outbound-queue';
import { debugLog } from '@/lib/debug-config';
import type { ChannelMessage } from './channel-types';
import { sendHeartbeat , type LeaderElectionState } from './channel-leader-election';

// ── Outbound Request (Follower -> Leader) ─────────────────────────────────

export function handleOutboundRequest(message: ChannelMessage): void {
  if (!instanceManager.isLeader) {
    debugLog('InstanceChannel', 'Received outbound-request but not leader, ignoring');
    return;
  }

  debugLog('InstanceChannel', `Leader received outbound-request from ${message.senderInstanceId}, requestId=${message.requestId}`);

  eventEmitter.emit('channel:outbound-request', {
    requestId: message.requestId,
    senderInstanceId: message.senderInstanceId,
    payload: message.payload,
  });
}

// ── Outbound ACK (Leader -> Follower) ─────────────────────────────────────

export function handleOutboundAck(message: ChannelMessage): void {
  if (message.requestId) {
    const result = {
      status: message.status || 'error',
      error: message.error,
      data: message.data,
    } as const;

    outboundQueue.acknowledge(message.requestId, result);

    eventEmitter.emit('outbound-ack', {
      requestId: message.requestId,
      status: result.status,
      error: result.error,
      data: result.data,
    });
  }
}

// ── Inbound Forward (Leader -> Follower) ──────────────────────────────────

export function handleInboundForward(message: ChannelMessage): void {
  eventEmitter.emit('channel:inbound-message', {
    payload: message.payload,
    senderInstanceId: message.senderInstanceId,
    requestId: message.requestId,
  });
}

/**
 * A forwarded message reached an attached handler in the target tab.
 *
 * Deliberately NOT routed through `outboundQueue.acknowledge`: that queue's
 * retry semantics are follower-to-leader, and its unknown-id path would log
 * noise for every inbound ack.
 */
export function handleInboundAck(message: ChannelMessage): void {
  if (!message.requestId) return;
  eventEmitter.emit('channel:inbound-ack', {
    requestId: message.requestId,
    senderInstanceId: message.senderInstanceId,
  });
}

// ── Instance Announce ─────────────────────────────────────────────────────

export function handleInstanceAnnounce(state: LeaderElectionState, message: ChannelMessage): void {
  const announcePayload: Record<string, unknown> | undefined = message.payload as Record<string, unknown> | undefined;
  const cid: bigint | null = (announcePayload?.cid as bigint | null) || null;
  debugLog('InstanceChannel', `handleInstanceAnnounce: from=${message.senderInstanceId}, cid=${cid?.toString()}`);

  // An announce is a document starting up (or rejoining after the bfcache): whatever
  // this instance id held before belongs to a page that is gone. Forgetting it first
  // makes the registration read as new, which is what prompts the leader to send the
  // tab the state it missed while it was not listening (follower-snapshot.ts).
  instanceManager.unregisterInstance(message.senderInstanceId);
  instanceManager.registerInstance(message.senderInstanceId, cid);

  if (instanceManager.isLeader) {
    debugLog('InstanceChannel', `[InstanceChannel] New instance announced, sending immediate heartbeat`);
    sendHeartbeat(state);
  }
}

// ── Instance Goodbye ──────────────────────────────────────────────────────

export function handleInstanceGoodbye(state: LeaderElectionState, message: ChannelMessage): void {
  instanceManager.unregisterInstance(message.senderInstanceId);

  if (instanceManager.leaderId === message.senderInstanceId) {
    debugLog('InstanceChannel', '[InstanceChannel] Leader is leaving, clearing leader state');
    instanceManager.setLeader(false, '');
    state.lastLeaderHeartbeat = 0;

    setTimeout(() => {
      // Lazy import to avoid circular dependency
      void import('./channel-leader-election').then(({ tryBecomeLeader }) => {
        tryBecomeLeader(state);
      });
    }, 100);
  }
}

// ── Session Release ───────────────────────────────────────────────────────

export function handleSessionRelease(message: ChannelMessage): void {
  if (!instanceManager.isLeader) {
    debugLog('InstanceChannel', 'Received session-release but not leader');
    return;
  }

  const releasePayload: Record<string, unknown> | undefined = message.payload as Record<string, unknown> | undefined;
  const releaseCid: unknown = releasePayload?.cid;
  if (!releaseCid) {
    debugLog('InstanceChannel', 'Received session-release without CID');
    return;
  }

  debugLog('InstanceChannel', `[InstanceChannel] Leader handling session release for CID ${releaseCid}`);
  eventEmitter.emit('session:release-request', { cid: releaseCid });
}

// ── CID Update ────────────────────────────────────────────────────────────

export function handleCidUpdate(message: ChannelMessage): void {
  const cidPayload: Record<string, unknown> | undefined = message.payload as Record<string, unknown> | undefined;
  const cidValue: unknown = cidPayload?.cid;
  const cidBigInt: bigint | null = cidValue ? BigInt(cidValue as string) : null;

  instanceManager.registerInstance(message.senderInstanceId, cidBigInt);

  debugLog('InstanceChannel',
    `[InstanceChannel] CID update from ${message.senderInstanceId}: ${cidBigInt?.toString() || 'null'}`
  );
}

/**
 * Re-send a queued outbound request after a leader change.
 *
 * `BroadcastChannel.postMessage` never delivers to the posting context, and the
 * inbound path filters self-traffic anyway — so when the tab that owns the queue
 * IS the new leader, posting to 'leader' addressed nobody and the replay was a
 * black hole. The comment on the retry subscription describes a recovery that
 * only worked when some OTHER tab won the election.
 */
export function replayOutboundRequest(
  requestId: string,
  payload: unknown,
  send: (message: ChannelMessage) => void
): void {
  const message: ChannelMessage = {
    type: 'outbound-request',
    targetInstanceId: 'leader',
    senderInstanceId: instanceManager.instanceId,
    timestamp: Date.now(),
    requestId,
    payload,
  };

  if (instanceManager.isLeader) {
    handleOutboundRequest(message);
    return;
  }
  send(message);
}
