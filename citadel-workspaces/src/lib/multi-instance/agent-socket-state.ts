/**
 * Whether the leader's socket to the agent is up, as every tab sees it.
 *
 * Only the leader holds a socket; followers proxy through it. So when the
 * leader lost its socket, only the leader knew: a follower's health check
 * answered "can send" from `!isLeader` alone, and nothing in it heard the loss
 * or the recovery. The tab the user was looking at showed no agent-down banner
 * and no signed-out notice, and looked connected while its messages vanished.
 *
 * The leader reports each change here and broadcasts it (leader-reconnect.ts);
 * a follower applies what the leader broadcast (channel-message-dispatch.ts).
 * Either way, the change is re-emitted locally as 'agent-socket-state'.
 */
import { eventEmitter } from '../event-emitter';

export interface AgentSocketState {
  up: boolean;
}

// Until the leader reports, a follower keeps the assumption it always made:
// that the leader it proxies through can send.
let leaderSocketUp: boolean = true;

export function isLeaderSocketUp(): boolean {
  return leaderSocketUp;
}

export function applyAgentSocketState(state: AgentSocketState): void {
  const changed: boolean = state.up !== leaderSocketUp;
  leaderSocketUp = state.up;
  if (changed) eventEmitter.emit('agent-socket-state', state);
}

/**
 * A follower applying the leader's report. The leader's reconnection is the
 * follower's too: 'on-ws-connection-success' is what re-syncs everything a tab
 * set up over the old connection, and only the leader's socket emitted it.
 */
export function applyLeaderSocketReport(state: AgentSocketState): void {
  const recovered: boolean = state.up && !leaderSocketUp;
  applyAgentSocketState(state);
  if (recovered) eventEmitter.emit('on-ws-connection-success');
}

export function readAgentSocketState(payload: unknown): AgentSocketState | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const up: unknown = (payload as Record<string, unknown>).up;
  return typeof up === 'boolean' ? { up } : null;
}
