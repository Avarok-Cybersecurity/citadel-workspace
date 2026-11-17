import { useCallback, useState } from 'react';
import { connectionManager } from '@/lib/connection';
import type { ActiveSession, SignedOutAccount } from '@/types/session-types';

/**
 * Which of the saved accounts are currently connected — and whether that is
 * known at all.
 *
 * `null` means the query has not answered. It is NOT the same as "none", and
 * the dialog rendered it as if it were: `getActiveSessions()` returns an empty
 * array when the socket is down or the request times out, so a transient
 * failure made the Active Sessions section vanish and stripped the "Active"
 * badge and green border from every saved account. The user was told,
 * positively and wrongly, that nothing was live.
 *
 * `queries.ts` names this hazard where the two accessors are defined — an empty
 * result "does NOT mean there are no sessions, and the two must never be
 * conflated" — and offers `getActiveSessionsResult` for callers that must not.
 * This is one of them.
 *
 * Its own module because the tri-state and the sentence that explains it belong
 * together, and because the dialog is at its length limit.
 */
export interface LiveSessions {
  /** `null` until answered; `[]` only when the answer was "none". */
  sessions: ActiveSession[] | null;
  /** From the same answer: accounts the agent signed out after a failed reconnect. Empty until answered. */
  signedOut: SignedOutAccount[];
  load: () => Promise<void>;
}

export function useLiveSessions(): LiveSessions {
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [signedOut, setSignedOut] = useState<SignedOutAccount[]>([]);

  // Stable, so the caller's effect can depend on it rather than suppressing
  // the dependency it actually has.
  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    const { ok, sessions: answered, signedOut: gaveUp } = await connectionManager.getActiveSessionsResult();
    // Left unknown on a query that did not answer, rather than recorded as none.
    setSessions(ok ? answered : null);
    setSignedOut(ok ? gaveUp : []);
  }, []);

  return { sessions, signedOut, load };
}

/**
 * Says the status is unknown, so the absence of every badge below reads as a
 * fact about the question rather than about the accounts.
 */
export function LiveStatusUnknown(): JSX.Element {
  return (
    <p role="status" data-testid="live-status-unknown" className="text-xs text-muted-foreground">
      Live session status could not be checked. Accounts below may still be connected.
    </p>
  );
}
