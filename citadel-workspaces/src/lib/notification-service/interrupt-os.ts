/**
 * The OS notification and its chime, for what the agent does not announce
 * itself (owner.ts). Loaded on the first notification for a window not in front;
 * the caller has already decided that, as the notification arrived (in-front.ts).
 */
import { playNotificationChime } from './chime';
import { showBrowserNotification } from './browser-notification';
import { notificationOwner } from './owner';
import { agentCapabilities, noticesHeard } from '@/lib/agent-conversations/capabilities';
import type { Notification } from './types';

export async function interruptTheOs(notification: Notification): Promise<void> {
  // Asked first: a follower learns whether a notifier is attached from the leader's answer.
  // A failed answer leaves none attached, so the browser is not silenced too.
  await agentCapabilities().catch((): null => null);
  // Read after the await: the agent's answer, and every change since, set it (capabilities.ts).
  if (notificationOwner(notification, { notifierAttached: noticesHeard.get() }) !== 'browser') return;
  showBrowserNotification(notification);
  playNotificationChime();
}
