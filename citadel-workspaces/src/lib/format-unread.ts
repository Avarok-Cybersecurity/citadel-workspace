/** The cap above which a sidebar unread badge stops counting and says "more than this". */
const UNREAD_BADGE_CAP: number = 99;

/**
 * How an unread count is written on a row's badge: the one spelling for every
 * conversation list, so the same backlog does not read "150" on one row and
 * "99+" on the next.
 */
export function formatUnreadCount(count: number): string {
  return count > UNREAD_BADGE_CAP ? `${UNREAD_BADGE_CAP}+` : String(count);
}
