// Frozen protocol-1 copy; see ./provenance.ts. Never edit: it stands for tabs already open.
/**
 * Channel Leader Election
 *
 * Leader election protocol: heartbeats, timeout detection, sticky leadership.
 * Extracted from InstanceChannel for file size management.
 */

import { eventEmitter } from '../../../../event-emitter';
import { instanceManager } from '../../../instance-manager';
import { debugLog } from '@/lib/debug-config';
import { INTERVAL } from '../../../../timeout-constants';
import type { ChannelMessage } from '../../../channel-types';

const HEARTBEAT_INTERVAL_MS: number = INTERVAL.HEARTBEAT_MS;
const LEADER_TIMEOUT_MS: number = INTERVAL.LEADER_TIMEOUT_MS;

export interface LeaderElectionState {
  lastLeaderHeartbeat: number;
  leaderCheckInterval: ReturnType<typeof setInterval> | null;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  initTime: number;
  send: (message: Omit<ChannelMessage, 'senderInstanceId' | 'timestamp'> & { senderInstanceId?: string; timestamp?: number }) => void;
}

export function handleLeaderElection(state: LeaderElectionState, message: ChannelMessage): void {
  const payload: Record<string, unknown> | undefined = message.payload as Record<string, unknown> | undefined;
  if (payload?.isLeader) {
    const theirId: bigint = BigInt((payload.instanceIdBigInt as string) || '0');
    const myId: bigint = instanceManager.instanceIdAsBigInt;

    // STICKY LEADERSHIP RULE 1: If we're already the leader, stay leader
    if (instanceManager.isLeader) {
      debugLog('InstanceChannel', `[InstanceChannel] Rejecting leader claim from ${message.senderInstanceId} - we are the established leader (sticky)`);
      sendHeartbeat(state);
      return;
    }

    // STICKY LEADERSHIP RULE 2 (post-remount survival): if the claimer has a
    // NEWER instance ID than ours, we are the older tab. After a React
    // remount we may have lost the `isLeader` flag locally, but the
    // BroadcastChannel persists our instance ID via sessionStorage and the
    // ChannelService Worker — so the *other* tab can tell we're older. The
    // older tab must reclaim leadership rather than yield, otherwise a HMR
    // reload or React Strict-Mode double-mount irrevocably hands the WS to
    // the newer tab and strands the original ILM/sink/state on a dead
    // leader instance. (Symptom: workspace tab redirected to /connect,
    // every cross-tab message dropped.) Reclaiming is cheap and correct
    // because if the other tab really is newer, we still hold the live
    // sessionStorage instance id from before the remount.
    if (myId < theirId) {
      debugLog('InstanceChannel', `[InstanceChannel] Rejecting leader claim from ${message.senderInstanceId} - we are older (my ${myId} < their ${theirId}); reclaiming leadership`);
      tryBecomeLeader(state);
      return;
    }

    // STICKY LEADERSHIP RULE 3: If there's already an established leader, ignore new claims
    const currentLeaderId: string | null = instanceManager.leaderId;
    if (currentLeaderId && currentLeaderId !== message.senderInstanceId) {
      const timeSinceHeartbeat: number = Date.now() - state.lastLeaderHeartbeat;
      if (timeSinceHeartbeat < LEADER_TIMEOUT_MS) {
        debugLog('InstanceChannel', `[InstanceChannel] Ignoring leader claim from ${message.senderInstanceId} - already following ${currentLeaderId}`);
        return;
      }
    }

    // No established leader (or current leader timed out) - accept this claim
    instanceManager.setLeader(false, message.senderInstanceId);
    state.lastLeaderHeartbeat = Date.now();

    eventEmitter.emit('instance:leader-changed', { isLeader: false, leaderId: message.senderInstanceId });
    eventEmitter.emit('leader-changed', { isLeader: false, leaderId: message.senderInstanceId });

    debugLog('InstanceChannel', `[InstanceChannel] Accepted leader ${message.senderInstanceId} (ID: ${theirId}, myId: ${myId})`);
  }
}

export function handleLeaderHeartbeat(state: LeaderElectionState, message: ChannelMessage): void {
  debugLog('InstanceChannel', `Heartbeat received from ${message.senderInstanceId}, current leaderId=${instanceManager.leaderId}`);

  // Established-leader-stays rule. Instance IDs are timestamp-derived
  // BigInts (see instance-manager.getOrCreateInstanceId), so LOWER id means
  // OLDER tab — i.e. the one that almost certainly already holds the live
  // WebSocket, the ILM state, every P2P sink, and every pending request.
  // Migrating leadership to a newer tab mid-session strands all of that on
  // the old leader and silently drops every cross-tab message. So when
  // both sides claim leadership simultaneously, the OLDER one stays. The
  // newer one yields below by falling through to demote-self.
  //
  // The previous "higher BigInt wins" rule stabilised split-brain but
  // produced the migration failure exactly described above. A peer that
  // legitimately needs to take over (e.g. original leader crashed) still
  // does so via tryBecomeLeader after LEADER_TIMEOUT_MS of no heartbeat —
  // that path is unaffected.
  if (instanceManager.isLeader) {
    const myId: bigint = instanceManager.instanceIdAsBigInt;
    let theirId: bigint;
    try { theirId = BigInt(message.senderInstanceId); } catch { theirId = 0n; }
    if (myId <= theirId) {
      debugLog('InstanceChannel', `Split-brain with ${message.senderInstanceId}: keeping leadership (we are older: my ${myId} <= their ${theirId})`);
      sendHeartbeat(state);
      return;
    }
    debugLog('InstanceChannel', `Split-brain with ${message.senderInstanceId}: yielding leadership (they are older: their ${theirId} < my ${myId})`);
    // Fall through to demote self.
  }

  state.lastLeaderHeartbeat = Date.now();

  if (instanceManager.leaderId !== message.senderInstanceId) {
    debugLog('InstanceChannel', `Acknowledging leader from heartbeat: ${message.senderInstanceId} (was: ${instanceManager.leaderId})`);
    instanceManager.setLeader(false, message.senderInstanceId);

    eventEmitter.emit('instance:leader-changed', { isLeader: false, leaderId: message.senderInstanceId });
    eventEmitter.emit('leader-changed', { isLeader: false, leaderId: message.senderInstanceId });
  }
}

export function startLeaderElection(state: LeaderElectionState): void {
  const INITIAL_WAIT_MS: number = HEARTBEAT_INTERVAL_MS + 500;

  state.leaderCheckInterval = setInterval(() => {
    const now: number = Date.now();
    const timeSinceInit: number = now - state.initTime;

    if (instanceManager.isLeader) {
      sendHeartbeat(state);
    } else if (timeSinceInit > INITIAL_WAIT_MS) {
      if (state.lastLeaderHeartbeat === 0) {
        debugLog('InstanceChannel', '[InstanceChannel] No heartbeat ever received, attempting to become leader');
        tryBecomeLeader(state);
      } else if (now - state.lastLeaderHeartbeat > LEADER_TIMEOUT_MS) {
        debugLog('InstanceChannel', '[InstanceChannel] Leader timeout, attempting to become leader');
        tryBecomeLeader(state);
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  setTimeout(() => {
    if (!instanceManager.leaderId && state.lastLeaderHeartbeat === 0) {
      debugLog('InstanceChannel', '[InstanceChannel] No leader detected after initial wait, attempting to become leader');
      tryBecomeLeader(state);
    }
  }, INITIAL_WAIT_MS);
}

export function tryBecomeLeader(state: LeaderElectionState): void {
  const myId: bigint = instanceManager.instanceIdAsBigInt;

  if (instanceManager.isLeader) {
    debugLog('InstanceChannel', '[InstanceChannel] Already leader, staying leader');
    sendHeartbeat(state);
    return;
  }

  if (state.lastLeaderHeartbeat > 0) {
    const timeSinceHeartbeat: number = Date.now() - state.lastLeaderHeartbeat;
    if (timeSinceHeartbeat < LEADER_TIMEOUT_MS) {
      debugLog('InstanceChannel', `[InstanceChannel] Recent heartbeat ${timeSinceHeartbeat}ms ago, not challenging (timeout: ${LEADER_TIMEOUT_MS}ms)`);
      return;
    }
    debugLog('InstanceChannel', `[InstanceChannel] Leader timed out (${timeSinceHeartbeat}ms > ${LEADER_TIMEOUT_MS}ms), claiming leadership`);
  } else {
    debugLog('InstanceChannel', '[InstanceChannel] No heartbeat ever received, claiming leadership');
  }

  instanceManager.setLeader(true, instanceManager.instanceId);
  state.lastLeaderHeartbeat = Date.now();

  state.send({
    type: 'leader-election',
    targetInstanceId: '*',
    senderInstanceId: instanceManager.instanceId,
    timestamp: Date.now(),
    payload: { isLeader: true, instanceIdBigInt: myId.toString() },
  });

  eventEmitter.emit('instance:leader-changed', { isLeader: true, leaderId: instanceManager.instanceId });
  eventEmitter.emit('leader-changed', { isLeader: true, leaderId: instanceManager.instanceId });

  debugLog('InstanceChannel', `[InstanceChannel] Became leader (ID: ${myId})`);
  sendHeartbeat(state);
}

/**
 * Give up leadership this tab cannot actually serve.
 *
 * Promotion is handled by an `async` listener, and `emit` calls handlers
 * synchronously — so a rejection from `createWebSocketAsLeader` escapes the
 * emitter's own try/catch and nothing observes it. The tab stayed `isLeader`,
 * kept winning every subsequent election (the first branch of `tryBecomeLeader`
 * short-circuits for an existing leader), and answered every request from every
 * tab in the browser with "WebSocket not ready" — forever, because there was no
 * self-demotion path anywhere. A leader that cannot serve never yielded, since
 * the yield branch only fires on a competing heartbeat that never comes.
 *
 * Broadcasting goodbye makes the other tabs re-elect within ~100ms rather than
 * waiting out LEADER_TIMEOUT_MS.
 */
export function relinquishLeadership(state: LeaderElectionState): void {
  if (!instanceManager.isLeader) return;

  debugLog('InstanceChannel', 'Relinquishing leadership: this tab cannot serve it');
  instanceManager.setLeader(false, '');

  // Our own cooldown, not a claim about anyone else: `tryBecomeLeader` refuses
  // to challenge within LEADER_TIMEOUT_MS of this stamp, so the tab that just
  // failed does not immediately re-claim and fail again. Other tabs keep their
  // own clocks and are unaffected.
  state.lastLeaderHeartbeat = Date.now();

  state.send({
    type: 'instance-goodbye',
    targetInstanceId: '*',
    senderInstanceId: instanceManager.instanceId,
    timestamp: Date.now(),
  });

  eventEmitter.emit('instance:leader-changed', { isLeader: false, leaderId: '' });
  eventEmitter.emit('leader-changed', { isLeader: false, leaderId: '' });
}

export function sendHeartbeat(state: LeaderElectionState): void {
  state.send({
    type: 'leader-heartbeat',
    targetInstanceId: '*',
    senderInstanceId: instanceManager.instanceId,
    timestamp: Date.now(),
  });
}
