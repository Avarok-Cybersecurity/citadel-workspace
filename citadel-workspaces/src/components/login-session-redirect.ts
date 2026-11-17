// Imported for its side effect: it is the listener for the 'session:activated' this
// module emits. Signed in from a freshly loaded landing page, nothing else had loaded
// it yet, the event reached nobody, and the P2P registry never started (live: presence
// unknown for everyone, peer lists empty, on every password sign-in).
import '@/lib/session-startup-service';
import { claimSessionForThisTab, type ClaimOutcome } from '@/lib/sessions/claim-session';
import { sessionSwitchToasts, type SessionSwitchToasts } from '@/lib/sessions/session-switch-toasts';
import { markLastAccessed } from '@/lib/sessions/last-accessed';
import { connectionManager } from "@/lib/connection";
import { eventEmitter } from "@/lib/event-emitter";
import { postAuthSetup } from '@/lib/post-auth-setup';
import { setSelectedUser } from "@/lib/tab-context";
import { debugLog } from '@/lib/debug-config';
import type { ToastOptions } from '@/hooks/use-toast';
import type { StoredSessions } from '@/types/session-types';
import { sessionIsOnServer } from '@/lib/sessions/same-server';

interface SessionRedirectTarget {
  cid: bigint;
  username: string;
  server_address: string;
}

interface SessionRedirectCallbacks {
  /** The `toast` from useToast(); typed from its own options so the two cannot drift. */
  toast: (opts: ToastOptions) => unknown;
  /**
   * Finishes the sign-in, and so opens the pending secure link: the landing page resolves it,
   * a takeover goes to the workspace whose loader does. Resolving it here as well consumed the
   * link, and onNext's own resolve then found nothing and sent the visitor to /workspace.
   */
  onNext: (connectionId: string) => void;
}

/**
 * Seamlessly redirect to an existing session instead of showing an error.
 * Provides smooth UX: user doesn't need to know the session already exists.
 */
export async function redirectToExistingSession(
  session: SessionRedirectTarget,
  callbacks: SessionRedirectCallbacks,
): Promise<void> {
  const { toast, onNext } = callbacks;
  const notices: SessionSwitchToasts = sessionSwitchToasts(session.cid, `${session.username}'s workspace`);

  try {
    debugLog('Login', 'Redirecting to existing session seamlessly:', session.username);

    toast(notices.progress);

    markLastAccessed(session.cid);

    const outcome: ClaimOutcome = await claimSessionForThisTab(session.cid);
    if (outcome.status === 'owned-by-another-tab') {
      toast(notices.ownedElsewhere);
      return;
    }

    const storedSessions: StoredSessions = connectionManager.getStoredSessions();
    const storedIndex: number = storedSessions.sessions.findIndex(
      (stored) =>
        stored.username === session.username &&
        sessionIsOnServer(session, stored.serverAddress)
    );

    if (storedIndex >= 0) {
      await connectionManager.setActiveSessionIndex(storedIndex);
    }

    await setSelectedUser({
      selectedUsername: session.username,
      selectedServerAddress: session.server_address,
      selectedCid: session.cid
    });

    await postAuthSetup(session.cid);

    eventEmitter.emit('session:activated', {
      cid: session.cid.toString(),
      username: session.username,
      serverAddress: session.server_address,
      activationType: 'claim',
    });
    debugLog('Login', 'Emitted session:activated for redirect to existing session');

    toast(notices.connected);

    onNext(session.cid.toString());
  } catch (error) {
    debugLog('Login', 'Failed to redirect to existing session:', error);
    toast(notices.failed("Could not reconnect to workspace. Please try again."));
  }
}
