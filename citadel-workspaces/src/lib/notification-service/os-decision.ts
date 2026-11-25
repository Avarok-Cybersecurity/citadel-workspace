/**
 * Whether a notification reaches the system's notification centre: the one rule, pure.
 *
 * Its inputs are read at the edge (service.ts): where the notification may go (`OsReach`, set by
 * its source from the member's settings), whether the window is in front (in-front.ts), and what
 * this browser allows (os-permission.ts). Nothing here asks for permission: browsers honour that
 * request only from a click, so a notice that needs it is held and the page shows an "Allow
 * notifications" control (OsNotificationsControl.tsx) instead of failing silently.
 */
import type { OsReach } from './types';

/** What this browser allows this site, or that it has no system notifications at all. */
export type OsPermission = NotificationPermission | 'unsupported';

export type OsDecision =
  /** Hand it to the system now. */
  | 'show'
  /** It is not for the system here: kept to the page, or the window is in front of a page-only reach. */
  | 'skip'
  /** It is for the system, but the member has not yet allowed notifications: ask with a click. */
  | 'needs-permission'
  /** It is for the system, but the browser refuses (blocked, or no such surface): say how to fix it. */
  | 'blocked';

export function osDecision(reach: OsReach, inFront: boolean, permission: OsPermission): OsDecision {
  if (reach === 'never') return 'skip';
  if (reach === 'when-away' && inFront) return 'skip';
  if (permission === 'granted') return 'show';
  if (permission === 'default') return 'needs-permission';
  return 'blocked';
}
