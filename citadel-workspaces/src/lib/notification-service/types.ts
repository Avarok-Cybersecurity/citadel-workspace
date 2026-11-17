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

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  content: string;
  sourceId?: string; // ID of the message, connection request, etc.
  senderId?: string; // User ID who triggered this notification
  senderName?: string; // What to call them; the card's avatar initials come from this, never from the id
  recipientCid?: string; // CID of the session this notification belongs to
  priority: NotificationPriority;
  read: boolean;
  timestamp: number;
  actionButtons?: NotificationAction[];
  data?: Record<string, unknown>; // Additional data specific to the notification type
  inAppOnly?: boolean; // Never the system's notification centre or its chime, only the page's list
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
 * An undefined `recipientCid` means the notification is not session-scoped
 * (system messages), so it is always shown.
 */
export function notificationBelongsTo(
  notification: { recipientCid?: string },
  cid: string | null
): boolean {
  if (notification.recipientCid === undefined) return true;
  return cid !== null && notification.recipientCid === cid;
}
