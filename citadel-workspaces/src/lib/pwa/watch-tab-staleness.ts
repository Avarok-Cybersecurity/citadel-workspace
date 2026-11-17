import { offerDeployNotice } from './deploy-notice';
import { reloadApplyingAnyWaitingUpdate } from './apply-waiting-update';
import { onReloadSafe, reloadIsSafe } from './reload-safety';
import { startStaleAutoReload } from './stale-auto-reload';
import { INTERVAL } from '@/lib/timeout-constants';
import { getTabStaleness, subscribeTabStaleness } from '@/lib/multi-instance/tab-staleness';
import { browserSessionStorage, reloadKeepingDrafts } from '@/lib/chat/draft-handoff';

/** Hands control to a waiting worker first, since the old one would serve the old build again. */
function reloadIntoTheNewBuild(): void {
  void reloadApplyingAnyWaitingUpdate((): void => window.location.reload());
}

/** The banner for a stale tab: one click, keeping drafts (DeployBanner wraps `accept`). */
export function offerStaleNotice(): void {
  offerDeployNotice({ reason: 'stale', accept: reloadIntoTheNewBuild });
}

/**
 * The browser's side of a stale tab, used once from main.tsx: the banner as soon as it is
 * stale, and the reload by itself once it has been hidden long enough (stale-auto-reload.ts).
 */
export function watchTabStaleness(): () => void {
  const isStale = (): boolean => getTabStaleness().stale;
  const bannerIfStale = (): void => { if (isStale()) offerStaleNotice(); };
  const stopBanner: () => void = subscribeTabStaleness(bannerIfStale);
  bannerIfStale(); // The channel may have heard a newer tab before this was called.
  const stopReload: () => void = startStaleAutoReload({
    hiddenForMs: INTERVAL.STALE_HIDDEN_RELOAD_MS,
    now: (): number => Date.now(),
    isHidden: (): boolean => document.visibilityState === 'hidden',
    onVisibilityChange: (listener: () => void): (() => void) => {
      document.addEventListener('visibilitychange', listener);
      return (): void => document.removeEventListener('visibilitychange', listener);
    },
    isStale,
    onStaleChange: subscribeTabStaleness,
    reloadIsSafe,
    onReloadSafe,
    schedule: (fn: () => void, ms: number): (() => void) => {
      const id: number = window.setTimeout(fn, ms);
      return (): void => window.clearTimeout(id);
    },
    reload: (): void => reloadKeepingDrafts(browserSessionStorage(), reloadIntoTheNewBuild),
  });
  return (): void => { stopBanner(); stopReload(); };
}
