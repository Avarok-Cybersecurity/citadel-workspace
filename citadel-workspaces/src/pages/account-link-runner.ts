import type { NavigateFunction } from 'react-router';
import type { useToast } from '@/hooks/use-toast';
import { connectionManager } from '@/lib/connection';
import { withoutForgotten } from '@/lib/sessions/forgotten-sessions';
import { withWorkspaceNames } from '@/lib/sessions/with-workspace';
import { readLastAccessed } from '@/lib/sessions/last-accessed';
import { switchToSession, type SwitchCallbacks } from '@/lib/sessions/switch-to-session';
import type { SignedOutSignIn } from '@/lib/sessions/sign-in-request';
import { debugLog } from '@/lib/debug-config';
import { parseAccountLink, type AccountLink } from '@/lib/onboarding/account-link';
import { stashLinkTarget } from '@/lib/onboarding/link-target';
import { openAccountLink, type AccountLinkDecision } from '@/lib/onboarding/open-account-link';
import type { OrphanSessionWithWorkspace } from '@/components/useOrphanSessions';
import { TIMEOUT } from '@/lib/timeout-constants';

type Toast = ReturnType<typeof useToast>['toast'];

/**
 * What the landing page runs for a URL that carries an account link: parse it, then
 * switch to its live session or start sign-in with its username. Loaded on demand by
 * use-account-link.ts, only when such a link is present. Resolves to what was done,
 * or null for a malformed link.
 */
export async function runAccountLink(
  params: URLSearchParams,
  deps: { navigate: NavigateFunction; toast: Toast; login: (username: string, server: string | null) => void; confirm: SwitchCallbacks['confirm'] },
): Promise<AccountLinkDecision<OrphanSessionWithWorkspace> | null> {
  const link: AccountLink | null = parseAccountLink(params);
  if (!link) {
    debugLog('Landing', 'Ignoring a malformed account link');
    return null;
  }
  // Taken by the workspace once it is open (NotificationCenter, TopBar).
  if (link.open) stashLinkTarget(link.open);
  return openAccountLink<OrphanSessionWithWorkspace>(link, {
    listSessions: async () => {
      await connectionManager.waitForReady();
      const { ok, sessions } = await connectionManager.getActiveSessionsResult();
      return {
        ok,
        sessions: withWorkspaceNames(
          withoutForgotten(sessions),
          connectionManager.getStoredSessions().sessions,
          readLastAccessed,
        ),
      };
    },
    signInDeadline: (): Promise<void> =>
      new Promise((resolve: () => void) => { setTimeout(resolve, TIMEOUT.ACCOUNT_LINK_SIGN_IN_MS); }),
    switchTo: (session: OrphanSessionWithWorkspace) =>
      switchToSession(session, {
        navigate: deps.navigate, toast: deps.toast, confirm: deps.confirm, signInAs: (username: string) => deps.login(username, null),
        // The landing page's own sign-in; the switch's notice has already said the session ended.
        signInAgain: (request: SignedOutSignIn) => deps.login(request.username, request.server),
      }),
    login: deps.login,
  });
}
