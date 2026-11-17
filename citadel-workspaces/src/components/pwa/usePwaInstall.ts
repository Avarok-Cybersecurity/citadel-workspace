import { useCallback, useSyncExternalStore } from 'react';
import {
  subscribeToInstallState,
  getPromptEvent,
  isAppInstalled,
  clearPromptEvent,
} from './install-prompt-store';
import { debugLog } from '@/lib/debug-config';
import type { BeforeInstallPromptEvent } from '@/components/pwa/install-prompt-store';

/**
 * The `beforeinstallprompt` event, which TypeScript's DOM lib does not declare.
 * Chromium fires it when the page meets the installability criteria (manifest +
 * service worker with a fetch handler + secure context).
 */

export interface PwaInstallState {
  /** True once the browser has offered an install prompt we can replay. */
  canInstall: boolean;
  /**
   * Installable, but only by hand.
   *
   * iOS Safari never fires `beforeinstallprompt` — there is no programmatic
   * install on that platform at all — so `canInstall` is permanently false
   * there and the button rendered nothing. That silently zeroed the install
   * funnel for every iPhone and iPad user, on a product whose primary mobile
   * surface is the installed PWA.
   */
  needsManualInstall: boolean;
  /** True when already running as an installed app, so installing is moot. */
  isInstalled: boolean;
  /** Shows the browser's install dialog. Resolves to whether the user accepted. */
  install: () => Promise<boolean>;
}


/**
 * Install affordance for the PWA.
 *
 * Chrome shows its own install button in the omnibox once the criteria are met;
 * this exists so the app can *also* offer it somewhere discoverable, since that
 * omnibox affordance is easy to miss and absent on some platforms.
 *
 * The event must be captured when it fires — it cannot be requested later — so
 * the listener is installed on mount and the event stashed until the user acts.
 */
export function usePwaInstall(): PwaInstallState {
  // Subscribed to the module-scope store rather than owning the listener, so
  // every consumer sees the same captured event no matter when it mounted.
  const promptEvent: BeforeInstallPromptEvent | null = useSyncExternalStore(
    subscribeToInstallState,
    getPromptEvent,
    () => null,
  );
  const isInstalled: boolean = useSyncExternalStore(
    subscribeToInstallState,
    isAppInstalled,
    () => false,
  );

  const install: () => Promise<boolean> = useCallback(async (): Promise<boolean> => {
    const event: BeforeInstallPromptEvent | null = getPromptEvent();
    if (!event) return false;
    await event.prompt();
    const { outcome } = await event.userChoice;
    // The event is single-use whichever way it goes; a dismissal means the
    // browser decides when (or whether) to offer another.
    clearPromptEvent();
    debugLog('PWA', `Install prompt ${outcome}`);
    return outcome === 'accepted';
  }, []);

  // Safari on iOS/iPadOS. Detected by the absence of a Chromium hook rather
  // than by browser name: iPadOS reports a Mac user-agent, so a name check
  // misses exactly the device most likely to install this.
  const isIosSafari: boolean =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  return {
    canInstall: promptEvent !== null && !isInstalled,
    needsManualInstall: isIosSafari && promptEvent === null && !isInstalled,
    isInstalled,
    install,
  };
}
