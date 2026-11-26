/**
 * A reminder the agent fired (agent kernel/reminders), as the page lists it. The agent tells every
 * window of the session (`AppNoticeNotification`, routed by its `cid`); only the window that runs
 * the member's Calendar work (calendar-background.ts, the runner lock's holder) lists it, so it is
 * listed once. When the menu-bar app already showed it (`shown_natively`) it goes nowhere beyond
 * the list; otherwise it reaches the system as the member chose for the Calendar's notices
 * (app-notice-delivery.ts), under the id the agent knows it by (`osTag`, agent-reminders.ts
 * `reminderId`), so the system shows one reminder once. It is marked `fromAgent`, so it is never
 * handed back to the agent (owner.ts).
 *
 * Pure: the window's side (page-agent-reminders.ts) hears and lists.
 */
import type { AppNotice, AppNoticeNotification } from 'citadel-internal-service-wasm-client';
import { appOsReach } from '@/lib/citadel-apps/app-notice-delivery';
import { openAppNode } from '@/lib/citadel-apps/app-notices';
import { NotificationPriority, NotificationType, type Notification } from '@/lib/notification-service/types';
import { CALENDAR_APP_ID } from './app-id';

const isText = (v: unknown): v is string => typeof v === 'string';

function noticeOf(v: unknown): AppNotice | null {
  if (typeof v !== 'object' || v === null) return null;
  const n: Record<string, unknown> = v as Record<string, unknown>;
  if (!isText(n.id) || !isText(n.app_id) || !isText(n.node_id) || !isText(n.title) || !isText(n.body)) return null;
  // serde-wasm-bindgen gives a None as undefined, not null.
  const senderOnly: unknown = n.sender_only ?? null;
  if (senderOnly !== null && !isText(senderOnly)) return null;
  return v as AppNotice;
}

/** The Calendar reminder a wire message carries; null for anything else. */
export function firedReminderOf(message: unknown): AppNoticeNotification | null {
  if (typeof message !== 'object' || message === null) return null;
  const v: unknown = (message as { AppNoticeNotification?: unknown }).AppNoticeNotification;
  if (typeof v !== 'object' || v === null) return null;
  const f: Record<string, unknown> = v as Record<string, unknown>;
  const notice: AppNotice | null = noticeOf(f.notice);
  if (typeof f.cid !== 'bigint' || notice === null || typeof f.late !== 'boolean' || typeof f.shown_natively !== 'boolean') return null;
  return notice.app_id === CALENDAR_APP_ID ? (v as AppNoticeNotification) : null;
}

/** The list entry for a reminder the agent fired, from the app named `appName`. */
export function firedReminderEntry(fired: AppNoticeNotification, appName: string): Omit<Notification, 'id' | 'timestamp' | 'read'> {
  const { notice } = fired;
  return {
    type: NotificationType.SYSTEM, priority: NotificationPriority.NORMAL,
    title: fired.late ? `Missed: ${notice.title}` : notice.title, content: notice.body,
    senderName: appName, recipient_cid: fired.cid.toString(),
    data: {
      appId: notice.app_id, nodeId: notice.node_id, senderLine: notice.sender_only ?? null,
      fromAgent: true, osTag: notice.id, onCardClick: openAppNode(notice.node_id),
    },
    osReach: fired.shown_natively ? 'never' : appOsReach(notice.app_id),
  };
}
