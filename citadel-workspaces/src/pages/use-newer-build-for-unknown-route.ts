/**
 * On the not-found page, a newer build that is waiting, deployed or already active in another window
 * is taken at once, through the same accept the deploy banner's Reload runs (drafts carried across).
 * A page left open across a deploy keeps the old precached shell, whose router has never seen a
 * route the new build adds, so the first visit to it renders 404 until the person notices the banner.
 *
 * Once per path per tab: if the reload lands on the same 404 (the route really does not exist, or
 * the update did not take), the banner is left to the person instead of reloading again. `stale`
 * is not taken: it can mean the kill switch already failed to reload this tab.
 */
import { useEffect } from 'react';
import { useDeployNotice } from '@/components/pwa/DeployBanner';
import type { DeployNotice, DeployNoticeReason } from '@/lib/pwa/deploy-notice';
import { browserSessionStorage, reloadKeepingDrafts } from '@/lib/chat/draft-handoff';
import { sessionGet, sessionSet } from '@/lib/safe-session-storage';

const TAKEN: ReadonlySet<DeployNoticeReason> = new Set<DeployNoticeReason>(['waiting', 'deployed', 'activated-elsewhere']);
export const RELOADED_FOR_KEY: string = 'citadel:not-found-reloaded-for';

/** Records `path` and says whether it was not recorded before; with no storage, never reloads. */
function firstTimeFor(path: string): boolean {
  if (sessionGet(RELOADED_FOR_KEY) === path) return false;
  return sessionSet(RELOADED_FOR_KEY, path);
}

export function useNewerBuildForUnknownRoute(path: string): void {
  const notice: DeployNotice | null = useDeployNotice();
  useEffect(() => {
    if (notice === null || !TAKEN.has(notice.reason) || !firstTimeFor(path)) return;
    reloadKeepingDrafts(browserSessionStorage(), notice.accept);
  }, [notice, path]);
}
