/**
 * When an open conversation counts as READ by the person at the keyboard.
 *
 * `document.visibilityState` stays 'visible' for a window that is on screen
 * but not focused (another app in front, the user typing elsewhere), so gating
 * on it alone told the sender "Seen" for messages nobody had looked at. A read
 * needs the window in front (visible AND focused), the Messages tab showing and
 * the reader at the bottom: a message that arrived while they are scrolled up
 * is only counted in the new-messages notch, and is read when they reach the
 * bottom (see use-catch-up-read).
 * Gaining focus is itself a trigger: the unread messages that arrived while
 * the window was behind are read at that moment.
 */
import { windowInFront } from '@/lib/agent-conversations/report-focus';

export function readableNow(activeTabIdRef: { readonly current: string | null }, pinnedRef: { readonly current: boolean }): boolean {
  return windowInFront() && activeTabIdRef.current === 'messages' && pinnedRef.current;
}

/** Calls `markRead` when the window comes to the front; returns the unsubscribe. */
export function markReadWhenInFront(activeTabIdRef: { readonly current: string | null }, pinnedRef: { readonly current: boolean }, markRead: () => void): () => void {
  const onChange = (): void => {
    if (readableNow(activeTabIdRef, pinnedRef)) markRead();
  };
  document.addEventListener('visibilitychange', onChange);
  window.addEventListener('focus', onChange);
  return (): void => {
    document.removeEventListener('visibilitychange', onChange);
    window.removeEventListener('focus', onChange);
  };
}
