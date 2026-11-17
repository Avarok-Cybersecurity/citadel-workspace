/**
 * The OS notification and its chime, for what the agent does not announce
 * itself (owner.ts). Loaded on the first notification for a window not in front;
 * the caller has already decided that, as the notification arrived (in-front.ts).
 */
import { playNotificationChime } from './chime';
import { showBrowserNotification } from './browser-notification';
import { notificationOwner } from './owner';
import { agentHostsConversations, noticesHeard } from '@/lib/agent-conversations/capabilities';
import type { Notification } from './types';

export async function interruptTheOs(notification: Notification): Promise<void> {
  // Unknown is not hosted: a failed capability answer must not silence the browser too.
  const hosts: boolean = await agentHostsConversations().catch((): boolean => false);
  // Read after the await: the agent's answer, and every change since, set it (capabilities.ts).
  if (notificationOwner(notification, { hostsConversations: hosts, notifierAttached: noticesHeard.get() }) !== 'browser') return;
  showBrowserNotification(notification);
  playNotificationChime();
}
