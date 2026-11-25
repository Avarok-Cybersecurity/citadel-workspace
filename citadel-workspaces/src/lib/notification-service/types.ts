/**
 * Notification Service Types
 *
 * Type definitions for the notification system.
 */

export interface UnreadCountChange {
  total: number;
  messages: number;
  peerRegistrations: number;
  system: number;
  byCid: Map<string, number>; // Per-session notification counts
}

export enum NotificationType {
  MESSAGE = 'message',
  PEER_REGISTRATION = 'peer_registration',
  SYSTEM = 'system'
}

export enum NotificationPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high'
}

/**
 * Where a notification may go beyond the page's list (os-decision.ts): nowhere; the system's
 * notification centre while the window is not in front (a chat message, whose in-app toast covers
 * a window in front); or the system's centre whenever it arrives (a notice the member sent to this
 * device, such as a Calendar reminder, which calendar apps show whether or not they are in front).
 */
export type OsReach = 'never' | 'when-away' | 'always';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  content: string;
  sourceId?: string; // ID of the message, connection request, etc.
  senderId?: string; // User ID who triggered this notification
  senderName?: string; // What to call them; the card's avatar initials come from this, never from the id
  recipient_cid?: string; // CID of the session this notification belongs to
  priority: NotificationPriority;
  read: boolean;
  timestamp: number;
  actionButtons?: NotificationAction[];
  data?: Record<string, unknown>; // Additional data specific to the notification type
  osReach: OsReach;
}

export interface NotificationAction {
  id: string;
  label: string;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  onClick: () => void;
}

export type NotificationHandler = (notification: Notification) => void;

/**
 * Whether a notification belongs to the session identified by `cid`.
 *
 * One predicate, used by both the initial load and the live handler — they sat
 * in different places in NotificationCenter and it would have been easy to
 * filter one and not the other, which leaks exactly the same way as filtering
 * neither.
 *
 * An undefined `recipient_cid` means the notification is not session-scoped
 * (system messages), so it is always shown.
 */
export function notificationBelongsTo(
  notification: { recipient_cid?: string },
  cid: string | null
): boolean {
  if (notification.recipient_cid === undefined) return true;
  return cid !== null && notification.recipient_cid === cid;
}
