/**
 * Noticing that the agent came back without this tab's session.
 *
 * The agent holds sessions in memory. When it restarts, the socket reconnects
 * and the retry dialog closes, but the session the tab is showing no longer
 * exists: every request for it is refused, and nothing on screen says why.
 *
 * Driven by the leader's socket state as every tab sees it
 * (multi-instance/agent-socket-state.ts), not by this tab's own socket events:
 * a follower has no socket, and it is usually the tab on screen.
 *
 * After a reconnect that follows a lost socket, wait `graceMs` (so an automatic
 * sign-in with saved credentials can land first), ask the agent which sessions
 * it holds, and report when this tab's is not among them. A failed query is
 * not an answer and reports nothing.
 */
import type { ActiveSessionsResult } from './queries';
import type { AgentSocketState } from '@/lib/multi-instance/agent-socket-state';
import { agentLacksSession } from '@/lib/sessions/agent-holds-session';

export interface SessionLostDeps {
  onAgentSocket(handler: (state: AgentSocketState) => void): () => void;
  currentCid(): Promise<bigint | null>;
  activeSessions(): Promise<ActiveSessionsResult>;
  wait(ms: number): Promise<void>;
  notifySessionLost(): void;
}

export function watchForSessionLostWithAgent(deps: SessionLostDeps, graceMs: number): () => void {
  let cidAtLoss: Promise<bigint | null> | null = null;

  return deps.onAgentSocket(({ up }: AgentSocketState): void => {
    if (!up) {
      cidAtLoss ??= deps.currentCid();
      return;
    }
    const lost: Promise<bigint | null> | null = cidAtLoss;
    cidAtLoss = null;
    if (!lost) return;
    void (async (): Promise<void> => {
      const cid: bigint | null = await lost;
      if (cid === null) return;
      await deps.wait(graceMs);
      const result: ActiveSessionsResult = await deps.activeSessions();
      if (agentLacksSession(cid, result)) deps.notifySessionLost();
    })();
  });
}
