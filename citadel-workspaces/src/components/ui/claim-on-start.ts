/**
 * Resuming, at page start, a session the agent already holds.
 *
 * Lifted out of `use-auto-claim-session` with its I/O injected, because two
 * live defects were decisions this made on one bad reading:
 *
 *   - One failed WebSocket during start-up, or one unanswered GetSessions, was
 *     final: the loader either gave up (and redirected to /connect while the
 *     agent still held the session) or went on without a started connection
 *     manager and waited for ever on "taking longer than expected". Reaching the
 *     agent is now retried with backoff before anything is concluded.
 *   - A session held by ANOTHER browser was adopted anyway: the agent refused
 *     the claim, the tab selected it, and the workspace it asked for never came.
 *     That is now its own answer, for the loader to offer the takeover.
 *   - A session the agent listed and then ended when claimed (it was reconnecting
 *     to a server that still held the old link) threw into a generic toast, and
 *     the loader timed out to /connect: a server picker, for an account whose
 *     sign-in form was the one thing that could help. That is its own answer too.
 */
import { pickSessionToClaim, type SessionChoice } from '@/lib/sessions/pick-session-to-claim';
import { calculateBackoffDelay } from '@/lib/utils/retry-utils';
import { isEndedByTheAgent, type ClaimOutcome } from '@/lib/sessions/claim-session';
import type { TabUserContext } from '@/lib/tab-context';
import type { ActiveSession } from '@/types/session-types';

export type StartClaim =
  /** Username and server too: the claimant activates the session, and the activation names them. */
  | { kind: 'claimed'; cid: bigint; username: string; server: string }
  | { kind: 'nothing-to-claim' }
  /** Every attempt went unanswered; nothing about the sessions is known. */
  | { kind: 'agent-unreachable' }
  | { kind: 'owned-by-another-tab' }
  | { kind: 'held-by-another-connection'; username: string }
  /** The agent had the session listed, then ended it: signing in to it is the way back. */
  | { kind: 'session-ended'; username: string; server: string; reason: string };

export interface StartClaimIO {
  /** True once the connection manager is up; false when it is not (yet). */
  ready: () => Promise<boolean>;
  activeSessions: () => Promise<{ ok: boolean; sessions: ActiveSession[] }>;
  selection: () => Promise<TabUserContext | null>;
  clearSelection: () => Promise<void>;
  select: (session: ActiveSession) => Promise<void>;
  claim: (cid: bigint) => Promise<ClaimOutcome>;
  /** Drop any cached session list: it still names the session the agent just ended. */
  forgetSessions: () => void;
  sleep: (ms: number) => Promise<void>;
}

export interface StartRetry {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/** The agent's session list, or null when no attempt got an answer. */
async function reachAgent(io: StartClaimIO, retry: StartRetry): Promise<ActiveSession[] | null> {
  for (let attempt: number = 0; attempt < retry.maxAttempts; attempt++) {
    if (attempt > 0) await io.sleep(calculateBackoffDelay(attempt - 1, retry));
    if (!(await io.ready())) continue;
    const { ok, sessions } = await io.activeSessions();
    if (ok) return sessions;
  }
  return null;
}

export async function claimOnStart(io: StartClaimIO, retry: StartRetry): Promise<StartClaim> {
  const sessions: ActiveSession[] | null = await reachAgent(io, retry);
  if (sessions === null) return { kind: 'agent-unreachable' };
  if (sessions.length === 0) return { kind: 'nothing-to-claim' };

  const existing: TabUserContext | null = await io.selection();
  // Reached only on an answered query, so a stale selection really is stale.
  const { session, staleSelection }: SessionChoice = pickSessionToClaim(sessions, existing?.selectedCid);
  if (staleSelection) await io.clearSelection();
  if (!session) return { kind: 'nothing-to-claim' };

  let outcome: ClaimOutcome;
  try {
    outcome = await io.claim(session.cid);
  } catch (error: unknown) {
    if (!isEndedByTheAgent(error)) throw error;
    io.forgetSessions();
    const server: string = session.server_host ?? session.server_address;
    return { kind: 'session-ended', username: session.username, server, reason: error.message };
  }
  if (outcome.status === 'owned-by-another-tab') return { kind: 'owned-by-another-tab' };
  if (outcome.status === 'held-by-another-connection') {
    return { kind: 'held-by-another-connection', username: session.username };
  }
  await io.select(session);
  return { kind: 'claimed', cid: session.cid, username: session.username, server: session.server_address };
}
