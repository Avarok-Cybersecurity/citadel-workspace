import { useCallback, useEffect, useRef , type MutableRefObject } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { announceWhenQuiet } from './announce-when-quiet';
import { useToast } from '@/hooks/use-toast';
import { debugLog } from '@/lib/debug-config';
import { applyWaitingUpdate } from '@/lib/pwa/apply-waiting-update';
import { offerDeployNotice } from '@/lib/pwa/deploy-notice';

/**
 * Offers a reload when a new build has been downloaded, and confirms when the
 * app is ready to work offline.
 *
 * Deliberately a prompt rather than an automatic update: this app holds a live
 * WebSocket, active P2P channels and in-flight collaborative-document state.
 * Swapping the bundle underneath an open session would drop all of it — quietly,
 * and usually mid-conversation. The user picks the moment.
 *
 * Renders nothing. The update offer goes to the deploy banner (DeployBanner),
 * which stays until the page reloads: as a toast it could be dismissed or lost
 * among other notifications, and the page then ran a superseded build against
 * a server that had moved on. The offline-ready notice is still a toast.
 */

/**
 * How often a running tab asks whether a new build exists.
 *
 * vite-plugin-pwa only checks at registration, i.e. on page load. This is a
 * workspace app people leave open for days at a time, so without a periodic
 * check a long-lived session would never learn an update had shipped — it would
 * sit on the old bundle until something forced a reload. An hour is frequent
 * enough that a deploy reaches people the same working day, and far too
 * infrequent to matter as traffic.
 */
const UPDATE_CHECK_INTERVAL_MS: number = 60 * 60 * 1000;

const reload = (): void => window.location.reload();
export function PwaUpdatePrompt(): null {
  const { toast } = useToast();

  const cleanupRef: MutableRefObject<(() => void) | null> = useRef<(() => void) | null>(null);

  useEffect((): () => void | undefined => (): void | undefined => cleanupRef.current?.(), []);

  // Whether the user clicked Reload in THIS window.
  //
  // skipWaiting activates the new worker for every client at once, so the
  // `controlling` event fires everywhere — and the library reloads on it unless
  // onNeedReload is supplied. Without this gate, one window's click reloaded
  // all of them, dropping each one's WebSocket and P2P channels mid-session.
  // A ref, not state: it is read inside a callback the library owns, and it
  // must not trigger a render.
  const weInitiatedUpdate: MutableRefObject<boolean> = useRef(false);

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
  } = useRegisterSW({
    onNeedReload: () => {
      if (weInitiatedUpdate.current) {
        window.location.reload();
        return;
      }
      // Another window took the update. Say so rather than yanking the page
      // out from under someone mid-conversation.
      // With an action, not just an instruction. An installed standalone
      // window has no reload button and no URL bar, so "reload when you are
      // ready" was something the user could not actually do — and the
      // re-offer-on-return path cannot help here either, because it is gated on
      // `registration.waiting`, which is already null once another window has
      // activated the new worker.
      offerDeployNotice({ reason: 'activated-elsewhere', accept: reload });
    },
    onRegisteredSW(url: string, registration: ServiceWorkerRegistration | undefined): void {
      debugLog('PWA', 'Service worker registered', url);
      if (!registration) return;

      const check = (): void => {
        // Offline, the request only fails and logs noise; the visibility and
        // online listeners below cover the moment connectivity returns.
        if (!navigator.onLine) return;
        registration.update().catch((error) => {
          debugLog('PWA', 'Update check failed', error);
        });
      };

      const timer: NodeJS.Timeout = setInterval(check, UPDATE_CHECK_INTERVAL_MS);

      // Also check at the two moments a user is most likely to have missed one:
      // coming back to the tab, and coming back online.
      const onVisible = (): void => {
        if (document.visibilityState === 'visible') check();
      };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('online', check);

      // Registration outlives this component in practice, but the listeners
      // should not accumulate if it ever remounts.
      cleanupRef.current = (): void => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('online', check);
      };
    },
    onRegisterError(error: unknown): void {
      debugLog('PWA', 'Service worker registration failed', error);
    },
  });

  /**
   * The single accept path for both the first offer and the return-to-tab
   * re-offer. Setting `weInitiatedUpdate` is what makes `onNeedReload` reload
   * THIS window instead of showing "Updated in another window" — the re-offer
   * used to omit it, so the user pressed Reload and was told to reload.
   */
  const acceptUpdate: () => void = useCallback((): void => {
    weInitiatedUpdate.current = true;
    void (async (): Promise<void> => {
      // `applyWaitingUpdate` rather than the library's `updateServiceWorker`,
      // because it reports whether a worker actually took control.
      //
      // Once another window has accepted the update, `registration.waiting` is
      // null everywhere -- and messaging SKIP_WAITING to nothing is a silent
      // no-op, so `controlling` never fires again. A window still showing its
      // original "Update available" toast therefore had a Reload button that
      // did nothing at all: the toast dismissed and the page stayed put.
      //
      // Worse, `weInitiatedUpdate` stayed true. On the NEXT deploy, if another
      // window accepted first, this window's `onNeedReload` would see the stale
      // flag and hard-reload mid-session without asking -- dropping the
      // WebSocket and P2P state that prompt-mode exists to protect.
      if (await applyWaitingUpdate()) return;
      weInitiatedUpdate.current = false;
      // The user pressed a button and is owed an outcome. If the new version is
      // already active elsewhere, a plain reload is what picks it up here.
      reload();
    })();
  }, []);

  useEffect(() => {
    if (!offlineReady) return;
    // Held until the screen is quiet: this is a capability notice with no
    // deadline, and it was landing beside "Could not reach the server" on a
    // failed first-run registration -- a green success toast next to the error
    // the user has to act on. See announce-when-quiet.
    const cancel: () => void = announceWhenQuiet((): void => {
      toast({
        title: 'Ready to work offline',
        description: 'Citadel has been installed and will now load without a connection.',
        variant: 'success',
      });
    });
    setOfflineReady(false);
    return cancel;
  }, [offlineReady, setOfflineReady, toast]);

  useEffect(() => {
    if (!needRefresh) return;
    offerDeployNotice({ reason: 'waiting', accept: acceptUpdate });
    setNeedRefresh(false);
  }, [needRefresh, setNeedRefresh, acceptUpdate]);

  // Re-offer the update when the user comes back to the tab.
  //
  // The effect above clears `needRefresh` as soon as the toast is raised, and
  // the service worker's `waiting` event does not fire again for the same
  // worker. So dismissing the toast once was terminal: the user stayed on that
  // build indefinitely, through any number of later releases, with nothing to
  // escalate and no way to ask for the update again.
  //
  // `registration.waiting` is the durable fact — it stays non-null for as long
  // as a new version is sitting there — so returning to the tab is a natural,
  // bounded moment to raise it again without nagging mid-task.
  useEffect(() => {
    const offerIfWaiting = (): void => {
      if (document.visibilityState !== 'visible') return;
      void navigator.serviceWorker?.getRegistration()
        .then((registration) => {
          if (!registration?.waiting) return;
          offerDeployNotice({ reason: 'waiting', accept: acceptUpdate });
        })
        .catch(() => undefined);
    };

    document.addEventListener('visibilitychange', offerIfWaiting);
    return (): void => document.removeEventListener('visibilitychange', offerIfWaiting);
  }, [acceptUpdate]);

  return null;
}
