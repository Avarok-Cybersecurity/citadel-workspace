import { useEffect } from 'react';
import { windowInFront } from '@/lib/agent-conversations/report-focus';

/**
 * Mark the open group read the moment the window comes to the front.
 *
 * Messages that arrive while the window is behind another are counted as unread
 * (they were not seen); the page's mount-time read never runs again, so without
 * this they stayed counted after the user returned to the very conversation they
 * were looking at.
 */
export function useReadWhenInFront(groupId: string | undefined, markRead: (groupId: string) => void): void {
  useEffect((): (() => void) | undefined => {
    if (!groupId) return undefined;
    const onChange = (): void => {
      if (windowInFront()) markRead(groupId);
    };
    document.addEventListener('visibilitychange', onChange);
    window.addEventListener('focus', onChange);
    return (): void => {
      document.removeEventListener('visibilitychange', onChange);
      window.removeEventListener('focus', onChange);
    };
  }, [groupId, markRead]);
}
