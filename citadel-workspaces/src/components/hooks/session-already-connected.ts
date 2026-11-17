import type React from 'react';
import { debugLog } from '@/lib/debug-config';
import { claimSessionForThisTab, SESSION_OWNED_ELSEWHERE , type ClaimOutcome } from '@/lib/sessions/claim-session';
import { describeFailure } from '@/lib/failure-message';
import { onSuccess, type RetryVisibility } from './connection-retry-visibility';

interface HandlerState {
  connectionError: string | null;
  orphanSessionCid: string | null;
  retry: RetryVisibility;
}

/**
 * The "you are already connected in another window" path.
 *
 * Split out of useConnectionHandler, which crossed the 250-line cap when the
 * retry dialog's visibility rule arrived. It is a cohesive unit on its own: one
 * event, one toast, one claim attempt, and none of it touches the rest of the
 * hook's state beyond clearing the retry dialog when the claim lands.
 */
export function makeSessionAlreadyConnectedHandler(deps: {
  toast: (options: Record<string, unknown>) => unknown;
  setState: React.Dispatch<React.SetStateAction<HandlerState>>;
}) {
  const { toast, setState } = deps;
return async (event: { cid: string; message: string }): Promise<void> => {
  debugLog('WorkspaceApp', 'Session already connected event:', event);
  toast({
    title: "Session Already Connected",
    description: "You are already connected in another window or tab.",
    variant: "destructive",
    action: {
      // "Use that session", not "Clear Sessions".
      //
      // The action here called disconnectOrphan(null), whose bulk branch
      // removes EVERY session on the agent whose socket is not currently
      // live — which is precisely the set the architecture describes as
      // intact and reclaimable, and which the orphan-sessions navbar exists
      // to restore. One click destroyed other workspaces' sessions
      // agent-wide, with no confirmation, no enumeration, and a success
      // toast that said only "Please try logging in again".
      //
      // The state the message describes has a correct remedy, and it is
      // claiming: this session is already live, so take it.
      label: "Use That Session",
      onClick: () => {
        void (async (): Promise<void> => {
          try {
            const outcome: ClaimOutcome = await claimSessionForThisTab(BigInt(event.cid));
            if (outcome.status === 'owned-by-another-tab') {
              toast(SESSION_OWNED_ELSEWHERE);
              return;
            }
            // Nothing moved: the agent will not hand over a session another connection holds.
            if (outcome.status === 'held-by-another-connection') {
              toast({ title: 'Open in another browser window', description: 'Sign in with your password to move it here.', variant: 'destructive' });
              return;
            }
            toast({
              title: "Session restored",
              description: "You are now using the session that was already open.",
              variant: "success",
            });
          } catch (error) {
            toast({
              title: "Could not use that session",
              description: describeFailure(
                error,
                "The session could not be taken over. Close the other tab and try again.",
              ),
              variant: "destructive",
            });
          }
        })();
      },
    },
  });
  setState(prev => ({ ...prev, retry: onSuccess() }));
};
}
