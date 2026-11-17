/**
 * Channel Leader Election
 *
 * Leader election protocol: heartbeats, timeout detection, sticky leadership.
 * Extracted from InstanceChannel for file size management.
 */

import { eventEmitter } from '../event-emitter';
import { instanceManager } from './instance-manager';
import { debugLog } from '@/lib/debug-config';
import { INTERVAL } from '../timeout-constants';
import type { ChannelMessage } from './channel-types';
import { readEnvelope, type ChannelEnvelope } from './channel-envelope';
import { outranks, ownRank, type LeaderRank } from './version-skew';
import { refusesToLead } from './tab-staleness';
import { admitLeaderEpoch, beginLeadership, followEpoch, outbid } from './leadership-epoch';
import { onLegacyClaim, onLegacyHeartbeat } from './legacy-v1-put-down';
import { sendHeartbeat, type LeaderElectionState } from './leadership-signals';

export { relinquishLeadership, sendHeartbeat, type LeaderElectionState } from './leadership-signals';

const HEARTBEAT_INTERVAL_MS: number = INTERVAL.HEARTBEAT_MS;
const LEADER_TIMEOUT_MS: number = INTERVAL.LEADER_TIMEOUT_MS;

/**
 * Every rule below compares builds before tabs: a newer build leads (`outranks`, version-skew.ts),
 * and a tab whose build is superseded never takes leadership (tab-staleness.ts). A message with
 * no envelope is from a protocol-1 build and goes to legacy-v1-put-down.ts instead.
 */
export function handleLeaderElection(state: LeaderElectionState, message: ChannelMessage): void {
  const payload: Record<string, unknown> | undefined = message.payload as Record<string, unknown> | undefined;
  if (payload?.isLeader) {
    const envelope: ChannelEnvelope | null = readEnvelope(message);
    if (envelope === null) return onLegacyClaim(state, message);
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
    if (outranks(ownRank(myId), { seq: envelope.seq, id: theirId }) && !refusesToLead()) {
      debugLog('InstanceChannel', `[InstanceChannel] Rejecting leader claim from ${message.senderInstanceId} - we outrank it (my ${myId} vs their ${theirId}); reclaiming leadership`);
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
    withdrawChallenge(state);
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
  const envelope: ChannelEnvelope | null = readEnvelope(message);
  if (envelope === null) return onLegacyHeartbeat(state, message);
  const me: LeaderRank = ownRank(instanceManager.instanceIdAsBigInt);
  let theirId: bigint;
  try { theirId = BigInt(message.senderInstanceId); } catch { theirId = 0n; }
  const them: LeaderRank = { seq: envelope.seq, id: theirId };
  if (instanceManager.isLeader) {
    if (!outranks(them, me)) {
      debugLog('InstanceChannel', `Split-brain with ${message.senderInstanceId}: keeping leadership (they do not outrank us)`);
      outbid(envelope.epoch); // Followers that took theirs come back to ours.
      sendHeartbeat(state);
      return;
    }
    debugLog('InstanceChannel', `Split-brain with ${message.senderInstanceId}: yielding leadership (they outrank us)`);
    followEpoch(envelope.epoch);
    // Fall through to demote self.
  } else if (!admitLeaderEpoch(envelope.epoch)) {
    debugLog('InstanceChannel', `Ignoring heartbeat from ${message.senderInstanceId}: epoch ${envelope.epoch} is older than the leadership followed`);
    return;
  } else if (outranks(them, me)) {
    withdrawChallenge(state); // A leader that outranks us answered: it would win the split-brain above.
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

/**
 * Against a leader that went quiet, challenge, and lead only if no older leader answers. A
 * background leader's heartbeats come about once a minute, so it looks dead; leading at once
 * claimed sessions and opened a socket that its prompt answer (rule 1) closed again, every few
 * seconds. With no leader ever heard (first tab, or after a goodbye) there is nobody to answer.
 */
export function tryBecomeLeader(state: LeaderElectionState): void {
  if (instanceManager.isLeader) {
    debugLog('InstanceChannel', '[InstanceChannel] Already leader, staying leader');
    sendHeartbeat(state);
    return;
  }
  if (refusesToLead()) {
    debugLog('InstanceChannel', '[InstanceChannel] Not claiming leadership: this tab runs a superseded build');
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
  if (state.challenge !== null) return;
  const myId: bigint = instanceManager.instanceIdAsBigInt;
  const heardALeader: boolean = state.lastLeaderHeartbeat > 0;
  state.send({
    type: 'leader-election',
    targetInstanceId: '*',
    senderInstanceId: instanceManager.instanceId,
    timestamp: Date.now(),
    payload: { isLeader: true, instanceIdBigInt: myId.toString() },
  });
  if (!heardALeader) return lead(state, myId);
  state.challenge = setTimeout((): void => {
    state.challenge = null;
    if (!instanceManager.isLeader && !refusesToLead()) lead(state, myId);
  }, INTERVAL.LEADER_CHALLENGE_MS);
}

function withdrawChallenge(state: LeaderElectionState): void {
  if (state.challenge !== null) clearTimeout(state.challenge);
  state.challenge = null;
}

function lead(state: LeaderElectionState, myId: bigint): void {
  beginLeadership();
  instanceManager.setLeader(true, instanceManager.instanceId);
  state.lastLeaderHeartbeat = Date.now();
  eventEmitter.emit('instance:leader-changed', { isLeader: true, leaderId: instanceManager.instanceId });
  eventEmitter.emit('leader-changed', { isLeader: true, leaderId: instanceManager.instanceId });
  debugLog('InstanceChannel', `[InstanceChannel] Became leader (ID: ${myId})`);
  sendHeartbeat(state);
}
