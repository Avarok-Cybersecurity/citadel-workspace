/**
 * Claiming an available session on mount, and reporting when it fails.
 *
 * Lifted out of WorkspaceLoader, which was 268 lines of which this was 158.
 * Both `postAuthSetup` awaits in here used to fail into `debugLog` and nothing
 * else -- and debugLog is compiled out of production -- so a new user saw
 * "Connected!", then a spinner, then "Workspace data is taking longer than
 * expected", with no cause and no action. The login path has toasted this
 * since it was written.
 */

// Imported for its side effect: the listener for the 'session:activated' emitted below.
import '@/lib/session-startup-service';
import { eventEmitter } from '@/lib/event-emitter';
import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { claimSessionForThisTab, SESSION_OWNED_ELSEWHERE } from '@/lib/sessions/claim-session';
import { claimOnStart, type StartClaim } from './claim-on-start';
import { AGENT_START_RETRY } from '@/lib/connection/constants';
import { ConnectionManager } from '@/lib/connection';
import { postAuthSetup } from '@/lib/post-auth-setup';
import { setSelectedUser, getSelectedUser, clearSelectedUser , type TabUserContext } from '@/lib/tab-context';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { debugLog, errorLog } from '@/lib/debug-config';
import { tabSelectionFromConnection, type TabSelection } from './tab-selection-from-connection';
import { describeFailure } from '@/lib/failure-message';
import { TIMEOUT } from '@/lib/timeout-constants';
import type { useToast } from '@/hooks/use-toast';
import type { CurrentConnectionInfo } from '@/lib/connection/types';
import type { ActiveSession } from '@/types/session-types';

interface AutoClaimOptions {
  isDevMode: boolean;
  toast: ReturnType<typeof useToast>['toast'];
  setHasConnection: Dispatch<SetStateAction<boolean | null>>;
  setIsAutoClaimingSession: Dispatch<SetStateAction<boolean>>;
  autoClaimAttempted: MutableRefObject<boolean>;
  /** The session is live in another browser: the agent will not hand it over without the password. */
  onHeldElsewhere: (username: string) => void;
  /** The agent ended the session it listed: only signing in to that account brings it back. */
  onSessionEnded: (username: string, server: string, reason: string) => void;
}

export function useAutoClaimSession({
  isDevMode,
  toast,
  setHasConnection,
  setIsAutoClaimingSession,
  autoClaimAttempted,
  onHeldElsewhere,
  onSessionEnded,
}: AutoClaimOptions): void {
// Auto-claim an available session on mount if no connection exists
useEffect(() => {
  if (isDevMode) {
    debugLog('WorkspaceLoader', 'Dev mode: Skipping auto-claim');
    return;
  }

  debugLog('WorkspaceLoader', ' Auto-claim useEffect running, attempted:', autoClaimAttempted.current);

  if (autoClaimAttempted.current) {
    debugLog('WorkspaceLoader', ' Skipping auto-claim (already attempted)');
    return;
  }
  autoClaimAttempted.current = true;

  const autoClaimSession = async (): Promise<void> => {
    debugLog('WorkspaceLoader', ' Starting auto-claim session process');

    const connectionManager: ConnectionManager = ConnectionManager.getInstance();

    const currentConnection: CurrentConnectionInfo | null = connectionManager.getConnectionInfo();
    debugLog('WorkspaceLoader', ' getConnectionInfo() returned:', {
      hasConnection: !!currentConnection,
      cid: currentConnection?.cid?.toString() ?? 'none',
      username: currentConnection?.username ?? 'none',
    });

    if (currentConnection?.cid && currentConnection.cid !== 0n) {
      debugLog('WorkspaceLoader', ' Already connected with CID:', currentConnection.cid);

      const existingSelection: TabUserContext | null = await getSelectedUser();
      if (!existingSelection?.selectedCid) {
        // What this needs is a username and a server address for a CID we are
        // already connected with, and the connection record usually holds both.
        // Asking the internal service for them again put a network round trip
        // on the path that decides whether this tab counts as signed in --
        // through `getActiveSessions`, which returns an EMPTY ARRAY when it
        // cannot ask or is not answered. `find` then matched nothing, the
        // selection was never written, and nothing said so.
        //
        // The cost of that lands nowhere near here: `resolveCurrentUserId`
        // reads the tab selection, so every permission fetch bails with
        // "nobody is signed in on this tab" and every gated control on the page
        // refuses. Round 328 traced that exact sentence back from CI.
        const known: TabSelection | null = tabSelectionFromConnection(currentConnection);
        if (known !== null) {
          await setSelectedUser(known);
        } else {
          // Only when the record is CID-only -- which it is when a bare
          // ConnectSuccess wrote it and nothing filled in the rest.
          const { ok, sessions } = await connectionManager.getActiveSessionsResult();
          const session: ActiveSession | undefined = sessions.find(s => s.cid === currentConnection.cid);
          if (session) {
            await setSelectedUser({
              selectedUsername: session.username,
              selectedServerAddress: session.server_address,
              selectedCid: session.cid
            });
          } else if (!ok) {
            // Said here, where it happened. The symptom appears later and
            // somewhere else, as a permission check that cannot name a user.
            errorLog(
              'WorkspaceLoader',
              'Could not record which account this tab is using: the session query went unanswered. Permission checks will refuse until it is retried.',
            );
          }
        }
      }

      // Reported, not swallowed.
      //
      // This await sat outside any try/catch, so a failure here landed in
      // runAsyncSetup's catch -- which does nothing but debugLog, and
      // debugLog is compiled out of production builds. A new user saw
      // "Connected!", then a spinner, then "Workspace data is taking longer
      // than expected" with no cause and no action. The login path has
      // toasted this since it was written; the registration path never did.
      try {
        await postAuthSetup(currentConnection.cid);
      } catch (error) {
        toast({
          title: 'Workspace Setup Failed',
          description: describeFailure(
            error,
            'Your account was created, but the workspace could not be prepared.',
          ),
          variant: 'destructive',
        });
      }

      setHasConnection(true);
      return;
    }

    setIsAutoClaimingSession(true);

    try {
      const result: StartClaim = await claimOnStart({
        // Bounded per attempt; claimOnStart retries, so a slow start is waited out, not concluded.
        ready: (): Promise<boolean> => Promise.race([
          connectionManager.waitForReady().then((): boolean => connectionManager.initialized),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), TIMEOUT.CLAIM_SESSION_MS)),
        ]),
        activeSessions: () => connectionManager.getActiveSessionsResult(),
        selection: getSelectedUser,
        clearSelection: clearSelectedUser,
        select: (session: ActiveSession) => setSelectedUser({
          selectedUsername: session.username,
          selectedServerAddress: session.server_address,
          selectedCid: session.cid,
        }),
        claim: claimSessionForThisTab,
        forgetSessions: (): void => connectionManager.invalidateSessionCache(),
        sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      }, AGENT_START_RETRY);
      debugLog('WorkspaceLoader', ' Start-up claim:', result.kind);

      if (result.kind === 'owned-by-another-tab') toast(SESSION_OWNED_ELSEWHERE);
      if (result.kind === 'held-by-another-connection') onHeldElsewhere(result.username);
      if (result.kind === 'session-ended') onSessionEnded(result.username, result.server, result.reason);
      if (result.kind !== 'claimed') return;

      await postAuthSetup(result.cid);
      // A reload is a claim. Without the activation nothing ran the startup
      // sequence, so after any page reload the P2P registry stayed stopped.
      eventEmitter.emit('session:activated', {
        cid: result.cid.toString(), username: result.username,
        serverAddress: result.server, activationType: 'claim',
      });
      setHasConnection(true);
      debugLog('WorkspaceLoader', ' Auto-claim complete, workspace loading initiated');
    } catch (error) {
      // Same reason as the branch above: the user is left on a spinner that
      // eventually says "taking longer than expected" and never says why.
      debugLog('WorkspaceLoader', 'Auto-claim session failed:', error);
      toast({
        title: 'Could Not Restore Your Session',
        description: describeFailure(
          error,
          'Your session could not be reconnected. Try signing in again.',
        ),
        variant: 'destructive',
      });
    } finally {
      setIsAutoClaimingSession(false);
    }
  };

  runAsyncSetup(autoClaimSession);
}, [isDevMode, toast, setHasConnection, setIsAutoClaimingSession, autoClaimAttempted, onHeldElsewhere, onSessionEnded]);
}
