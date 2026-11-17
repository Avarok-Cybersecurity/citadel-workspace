/**
 * The registration service's periodic peer check (ListAllPeers +
 * ListRegisteredPeers for this tab's session), and when it ends by itself.
 *
 * The agent keeps sessions in memory, so a restart ends all of them while the
 * tab still holds its CID. This poll used to swallow every failure and go on,
 * so a tab left open across an agent restart asked about a session that no
 * longer existed every 30s for ever, each answered "Session for <cid> not
 * found in session manager".
 *
 * That refusal now ends the poll -- once the agent's own session list confirms
 * the CID is not held (see agent-holds-session). A session the agent still
 * lists is polled on, and an unreadable list is not an answer. I/O arrives as
 * deps, so the rule is testable against a fake agent.
 */
import type { ActiveSessionsResult } from '@/lib/connection/queries';
import { agentLacksSession, isSessionNotFoundRefusal } from '@/lib/sessions/agent-holds-session';

export interface PeerPollDeps {
  /** One round of peer checks; rejects with the agent's refusal. */
  check(): Promise<void>;
  currentCid(): Promise<bigint | null>;
  activeSessions(): Promise<ActiveSessionsResult>;
  /** The poll has stopped because the agent no longer holds `cid`. */
  onSessionGone(cid: bigint): void;
  onError(error: unknown): void;
}

export interface PeerPoll {
  /** Run a round now (skipped while one is in flight). */
  runNow(): Promise<void>;
  stop(): void;
  /** Rounds are skipped while paused: the session is being re-dialled and cannot answer. */
  pause(): void;
  resume(): void;
  readonly running: boolean;
  readonly paused: boolean;
}

export function startPeerPoll(deps: PeerPollDeps, intervalMs: number): PeerPoll {
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: boolean = false;
  let paused: boolean = false;

  const stop = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  const goneCid = async (error: unknown): Promise<bigint | null> => {
    if (!isSessionNotFoundRefusal(error)) return null;
    const cid: bigint | null = await deps.currentCid();
    if (cid === null) return null;
    return agentLacksSession(cid, await deps.activeSessions()) ? cid : null;
  };

  const runNow = async (): Promise<void> => {
    if (timer === null || inFlight || paused) return;
    inFlight = true;
    try {
      await deps.check();
    } catch (error: unknown) {
      const cid: bigint | null = await goneCid(error);
      if (cid === null) {
        deps.onError(error);
      } else {
        stop();
        deps.onSessionGone(cid);
      }
    } finally {
      inFlight = false;
    }
  };

  timer = setInterval((): void => { void runNow(); }, intervalMs);

  return {
    runNow,
    stop,
    pause: (): void => { paused = true; },
    resume: (): void => { paused = false; },
    get paused(): boolean { return paused; },
    get running(): boolean { return timer !== null; },
  };
}
