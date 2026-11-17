import { useEffect, useState } from 'react';

export interface OnlineStatus {
  isOnline: boolean;
  /**
   * True for a short while after connectivity returns, so the UI can confirm
   * recovery instead of the offline notice just vanishing — a banner that
   * disappears silently leaves the user unsure whether it worked.
   */
  justReconnected: boolean;
}

/** How long "Back online" stays up before the banner retires itself. */
export const RECONNECTED_NOTICE_MS: number = 3000;

/**
 * Track whether the browser has network connectivity.
 *
 * `navigator.onLine` is read for the INITIAL value rather than assuming online:
 * the app can be launched from the home screen with no connection at all, and
 * the 'offline' event only fires on a transition, so an app that starts offline
 * would never hear one.
 *
 * Note the browser's limits — onLine means "there is a network interface", not
 * "the internet is reachable". It is reliable for the case that matters here (a
 * device with no connectivity) and cannot detect a captive portal or a server
 * that is simply down. Connection state to our own services is reported
 * separately by the connection layer.
 */
export function useOnlineStatus(): OnlineStatus {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [justReconnected, setJustReconnected] = useState(false);

  useEffect(() => {
    const handleOnline = (): void => {
      setIsOnline(true);
      setJustReconnected(true);
    };
    const handleOffline = (): void => {
      setIsOnline(false);
      setJustReconnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return (): void => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!justReconnected) return;
    const timer: NodeJS.Timeout = setTimeout((): void => setJustReconnected(false), RECONNECTED_NOTICE_MS);
    // Cleared on unmount and on a further change, so a flapping connection
    // cannot leave a stale "Back online" on screen.
    return (): void => clearTimeout(timer);
  }, [justReconnected]);

  return { isOnline, justReconnected };
}
