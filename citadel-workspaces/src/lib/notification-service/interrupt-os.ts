/**
 * The OS notification and its chime, for what the agent does not announce
 * itself (owner.ts), saying only what the account's preview setting allows
 * (os-preview.ts). Loaded with the first notification the system is owed; the
 * caller has already decided that, as the notification arrived (os-decision.ts).
 */
import { playNotificationChime } from './chime';
import { showBrowserNotification } from './browser-notification';
import { notificationOwner, type NotificationOwner } from './owner';
import { agentCapabilities, appNotices, noticesHeard } from '@/lib/agent-conversations/capabilities';
import { handedToAgent } from './agent-app-notice';
import type { Notification } from './types';
import { accountPreview } from './account-preview';
import { osContent, type OsContent } from './os-preview';

/** One at a time, in arrival order: reading a preview setting must not let a later notification overtake. */
let turn: Promise<void> = Promise.resolve();

export function interruptTheOs(notification: Notification): Promise<void> {
  const mine: Promise<void> = turn.then(() => interruptNow(notification));
  turn = mine.catch((): void => undefined);
  return mine;
}

async function interruptNow(notification: Notification): Promise<void> {
  // Asked first: a follower learns whether a notifier is attached from the leader's answer.
  // A failed answer leaves none attached, so the browser is not silenced too.
  await agentCapabilities().catch((): null => null);
  // Read after the await: the agent's answer, and every change since, set it (capabilities.ts).
  const owner: NotificationOwner = notificationOwner(notification, { notifierAttached: noticesHeard.get(), appNotices: appNotices.get() });
  if (owner === 'agent') return;
  if (owner === 'hand-to-agent' && (await handedToAgent(notification))) return;
  // What it may say on the lock screen: the account's preview setting (os-preview.ts).
  const said: OsContent = osContent(notification, await accountPreview(notification.recipient_cid));
  showBrowserNotification({ ...notification, title: said.title, content: said.body });
  playNotificationChime();
}
