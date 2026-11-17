import { VERSION_MANIFEST_PATH } from './deployed-version';
import { respondToDeploy, startVersionWatch } from './version-watch';
import { applyWaitingUpdate } from './apply-waiting-update';
import { offerStaleNotice, watchTabStaleness } from './watch-tab-staleness';
import { INTERVAL } from '@/lib/timeout-constants';
import { BUILD_SEQ, declareRunningEntry } from '@/lib/multi-instance/build-identity';
import { markStale } from '@/lib/multi-instance/tab-staleness';
import { browserSessionStorage } from '@/lib/chat/draft-handoff';
import { debugLog } from '@/lib/debug-config';

/**
 * Everything that tells this page its build is superseded, used once from main.tsx: a newer
 * deploy (the `/version.json` poll, with its kill switch) or a newer build open in another
 * tab (multi-instance/tab-staleness.ts).
 */
export function watchThisBuild(entryUrl: string): void {
  declareRunningEntry(entryUrl, window.location.origin);
  watchDeployedVersion(entryUrl);
  watchTabStaleness();
}

/** The browser's side of both. */
export function watchDeployedVersion(runningEntry: string): () => void {
  const container: ServiceWorkerContainer | undefined = navigator.serviceWorker as ServiceWorkerContainer | undefined;
  const checkWorker = async (): Promise<void> => { await (await container?.getRegistration())?.update(); };
  return startVersionWatch({
    runningEntry,
    runningSeq: BUILD_SEQ,
    origin: window.location.origin,
    intervalMs: INTERVAL.DEPLOYED_VERSION_MS,
    fetchManifest: async (): Promise<unknown> => {
      const response: Response = await fetch(VERSION_MANIFEST_PATH, { cache: 'no-store' });
      if (!response.ok) return null;
      return response.json().catch((): null => null);
    },
    isOnline: (): boolean => navigator.onLine,
    onWake: (check: () => void): (() => void) => {
      const onVisible = (): void => { if (document.visibilityState === 'visible') check(); };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('online', check);
      return (): void => {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('online', check);
      };
    },
    setInterval: (fn: () => void, ms: number): unknown => window.setInterval(fn, ms),
    clearInterval: (handle: unknown): void => window.clearInterval(handle as number),
    onNewDeploy: (): void => {
      markStale('deployed');
      respondToDeploy({
        workerControlsPage: (): boolean => Boolean(container?.controller),
        checkWorker,
        reload: (): void => window.location.reload(),
      });
    },
    onKillSwitch: (): void => {
      markStale('deployed');
      // Loaded only when pulled. If its chunk went with the old build, Vite's preload error
      // reloads keeping drafts (main.tsx), which is what the kill switch does anyway.
      void import('./kill-switch').then(({ runKillSwitch }) => runKillSwitch({
        runningSeq: BUILD_SEQ,
        storage: browserSessionStorage(),
        checkWorker,
        applyWaitingUpdate,
        reload: (): void => window.location.reload(),
        offerReload: offerStaleNotice,
      })).catch((error: unknown): void => { debugLog('PWA', 'Kill switch failed', error); });
    },
  });
}
