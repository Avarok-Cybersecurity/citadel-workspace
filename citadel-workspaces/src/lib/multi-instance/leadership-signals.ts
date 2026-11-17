/**
 * The election's state and the two signals a leader sends about itself: its heartbeat and its
 * goodbye. Split from channel-leader-election.ts, which keeps the decisions, so the modules
 * that only signal (the legacy put-down, the messaging handlers) do not import the election.
 */
import { eventEmitter } from '../event-emitter';
import { instanceManager } from './instance-manager';
import { debugLog } from '@/lib/debug-config';
import type { ChannelMessage } from './channel-types';

export interface LeaderElectionState {
  lastLeaderHeartbeat: number;
  leaderCheckInterval: ReturnType<typeof setInterval> | null;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  initTime: number;
  /** A challenge sent and not yet answered; see tryBecomeLeader. */
  challenge: ReturnType<typeof setTimeout> | null;
  send: (message: Omit<ChannelMessage, 'senderInstanceId' | 'timestamp'> & { senderInstanceId?: string; timestamp?: number }) => void;
}

export function sendHeartbeat(state: LeaderElectionState): void {
  state.send({
    type: 'leader-heartbeat',
    targetInstanceId: '*',
    senderInstanceId: instanceManager.instanceId,
    timestamp: Date.now(),
  });
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
 * Also how a leader running a superseded build hands over to a newer tab, once
 * the requests it is executing have been answered (leader-outbound-handler.ts).
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
