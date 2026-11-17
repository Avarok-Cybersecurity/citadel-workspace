/**
 * The agent keeps sessions in memory, so when it restarts they are gone. The
 * tab reconnected its socket and went on showing the workspace as if nothing
 * had happened, while every request for the session was refused.
 *
 * After the leader's socket comes back from a loss -- in the leader and in every
 * follower, which is usually the tab on screen -- the tab now asks the agent for
 * its sessions and, if its own is not among them, says so.
 */
import { describe, it, expect, vi } from 'vitest';
import { watchForSessionLostWithAgent, type SessionLostDeps } from '../sessions-lost-with-agent';
import type { ActiveSessionsResult } from '../queries';
import type { ActiveSession } from '@/types/session-types';
import type { AgentSocketState } from '@/lib/multi-instance/agent-socket-state';

type Handler = (state: AgentSocketState) => void;

interface Harness { deps: SessionLostDeps; fire: (event: 'down' | 'up') => Promise<void>; notify: ReturnType<typeof vi.fn> }

function harness(opts: { currentCid: bigint | null; sessions: ActiveSessionsResult }): Harness {
  const handlers: Handler[] = [];
  const notify: ReturnType<typeof vi.fn> = vi.fn();
  const deps: SessionLostDeps = {
    onAgentSocket: (handler: Handler) => {
      handlers.push(handler);
      return () => undefined;
    },
    currentCid: async () => opts.currentCid,
    activeSessions: async () => opts.sessions,
    wait: async () => undefined,
    notifySessionLost: notify,
  };
  const fire = async (event: 'down' | 'up'): Promise<void> => {
    for (const h of handlers) h({ up: event === 'up' });
    // The check runs detached from the emit, as it does under the real emitter.
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  };
  return { deps, fire, notify };
}

const session: (cid: bigint) => ActiveSession = (cid: bigint): ActiveSession => ({ cid } as unknown as ActiveSession);

describe('a session lost with the agent', () => {
  it('is announced after the socket comes back without it', async () => {
    const h: Harness = harness({ currentCid: 7n, sessions: { ok: true, sessions: [session(9n)], signedOut: [] } });
    watchForSessionLostWithAgent(h.deps, 0);
    await h.fire('down');
    await h.fire('up');
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it('is not announced when the session survived', async () => {
    const h: Harness = harness({ currentCid: 7n, sessions: { ok: true, sessions: [session(7n)], signedOut: [] } });
    watchForSessionLostWithAgent(h.deps, 0);
    await h.fire('down');
    await h.fire('up');
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('is not announced on the first connection, or when the answer was a failure', async () => {
    const first: Harness = harness({ currentCid: 7n, sessions: { ok: true, sessions: [], signedOut: [] } });
    watchForSessionLostWithAgent(first.deps, 0);
    await first.fire('up');
    expect(first.notify).not.toHaveBeenCalled();

    // A failed query is not "you have no sessions" (queries.ts).
    const failed: Harness = harness({ currentCid: 7n, sessions: { ok: false, sessions: [], signedOut: [] } });
    watchForSessionLostWithAgent(failed.deps, 0);
    await failed.fire('down');
    await failed.fire('up');
    expect(failed.notify).not.toHaveBeenCalled();
  });

  it('is not announced for a tab that was not signed in', async () => {
    const h: Harness = harness({ currentCid: null, sessions: { ok: true, sessions: [], signedOut: [] } });
    watchForSessionLostWithAgent(h.deps, 0);
    await h.fire('down');
    await h.fire('up');
    expect(h.notify).not.toHaveBeenCalled();
  });
});
