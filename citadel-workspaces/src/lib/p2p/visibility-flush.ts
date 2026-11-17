/**
 * Flush whatever was deferred while the tab was hidden, when it comes back.
 *
 * Extracted from `P2PMessengerManager.setupEventListeners` at the 250-line cap.
 * It is the one listener there that is not on the app's own event bus — it goes
 * straight to the DOM — and it is the only one that needs the `typeof document`
 * guard for the non-browser test environment.
 *
 * Named `bind…` so `check-installers-are-called` covers it.
 */
export function bindVisibilityFlush(flush: () => void): void {
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flush();
  });
}
