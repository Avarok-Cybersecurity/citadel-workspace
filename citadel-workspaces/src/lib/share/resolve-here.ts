/**
 * `resolvePendingRedirectWith`, wired to this tab: its stored link, its session, the toast.
 * The one function every post-sign-in path calls.
 */
import { toast } from 'sonner';
import { browserSessionStorage } from '@/lib/chat/draft-handoff';
import { getSelectedUser, type TabUserContext } from '@/lib/tab-context';
import { connectionManager } from '@/lib/connection';
import { tabIdentity } from '@/lib/tab-identity';
import type { StoredSession } from '@/types/session-types';
import { peekPendingRedirect, takePendingRedirect } from './pending-redirect';

/** The workspace server this tab's session is on, or null when it is not known. */
export async function thisTabsServer(): Promise<string | null> {
  const selection: TabUserContext | null = await getSelectedUser();
  const session: StoredSession | null = await connectionManager.getTabSelectedSession();
  return tabIdentity(selection, session).serverAddress ?? null;
}

/**
 * Open the link this tab arrived with, or go to `fallback` (null: stay).
 *
 * Every ordinary sign-in has no link, and is answered here: the resolver, its target rules and the
 * secure-links client load only when there is one, so they stay off the landing page's critical
 * path (check-bundle-budget.mjs lists them in DEFERRED_MODULES).
 */
export async function resolvePendingRedirect(navigate: (path: string) => void, fallback: string | null): Promise<void> {
  if (peekPendingRedirect(browserSessionStorage()) === null) {
    if (fallback !== null) navigate(fallback);
    return;
  }
  const [{ resolvePendingRedirectWith, UNAVAILABLE_COPY }, { secureLinksApi }] = await Promise.all([
    import('./resolve-pending-redirect'),
    import('./secure-links-api'),
  ]);
  return resolvePendingRedirectWith({
    peek: () => peekPendingRedirect(browserSessionStorage()),
    take: () => takePendingRedirect(browserSessionStorage()),
    ready: secureLinksApi.ready,
    sessionServer: thisTabsServer,
    resolve: secureLinksApi.resolve,
    navigate,
    unavailable: (detail: string): void => { toast.error(UNAVAILABLE_COPY.title, { description: detail }); },
  }, fallback);
}
