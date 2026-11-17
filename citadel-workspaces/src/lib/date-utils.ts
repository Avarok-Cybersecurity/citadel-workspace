import { formatRelative } from '@/lib/format-time';

/**
 * Presence line for a user, when last-seen time may be unknown.
 *
 * Nothing in the workspace tracks last-seen yet. Callers previously invented a
 * value — `Math.random()` offsets in UserSearch, a literal `0` in UserDirectory
 * (rendered as a date in 1970), and `?? Date.now()` in UserProfileCard (rendered
 * as "just now"). Three different fictions for the same missing fact. Saying so
 * plainly is the honest option, and keeps the decision in one place.
 */
export function formatPresence(isOnline: boolean | null, lastActive?: number): string {
  if (isOnline === true) return 'Online now';
  // Null is not offline. The same fiction this function was written to stop for
  // last-seen was still being told one field over: a peer nobody had asked
  // about, and a peer the agent reported as away, read identically.
  if (isOnline === null) return 'Presence not known';
  if (!lastActive) return 'Last seen unknown';
  return `Last active ${formatRelative(lastActive)}`;
}
