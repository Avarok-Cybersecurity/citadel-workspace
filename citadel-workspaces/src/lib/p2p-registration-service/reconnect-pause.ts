/**
 * The peer poll waits out a reconnect. While the agent re-dials the workspace server for this
 * tab's session (`ServerConnectionLost`, `reconnecting: true`) a round can only fail or time
 * out; it resumes, with a round at once, on `ServerReconnected`. A loss the agent has given
 * up on (`reconnecting: false`) does not pause: that session is ending, and its
 * DisconnectNotification stops the poll.
 */
import { readAgentReconnectEvent, type AgentReconnectEvent } from '@/types/agent-reconnect';
import type { PeerPoll } from './peer-poll';

export type PollGate = 'pause' | 'resume' | null;

/** What a message means for the poll of session `ownCid`: nothing, unless it names that session. */
export function pollGateFor(event: AgentReconnectEvent | null, ownCid: bigint | null): PollGate {
  if (event === null || ownCid === null || event.cid !== ownCid) return null;
  if (event.kind === 'lost') return event.reconnecting ? 'pause' : null;
  return event.kind === 'reconnected' ? 'resume' : null;
}

/** Reads `message` and, only if it is a reconnect notification, asks which session this tab is. */
export async function followReconnect(poll: PeerPoll, message: unknown, currentCid: () => Promise<bigint | null>): Promise<void> {
  const event: AgentReconnectEvent | null = readAgentReconnectEvent(message);
  if (event === null) return;
  const gate: PollGate = pollGateFor(event, await currentCid());
  if (gate === 'pause') {
    poll.pause();
  } else if (gate === 'resume') {
    poll.resume();
    void poll.runNow();
  }
}
