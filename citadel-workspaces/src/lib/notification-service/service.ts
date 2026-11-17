/**
 * Notification Service
 *
 * Centralized service to manage all types of notifications in the application.
 */
import { eventEmitter } from '../event-emitter';
import { notifyEach } from '@/lib/notify-listeners';
import { mayInterruptTheOs } from './in-front';
import { v4 as uuidv4 } from 'uuid';
import { debugLog, errorLog } from '@/lib/debug-config';
import type { Notification, NotificationHandler, UnreadCountChange } from './types';
import { NotificationType, NotificationPriority, notificationBelongsTo } from './types';
import { belongingTo, everything, messagesFrom, messagesInGroup, type ReadPredicate } from './read-state';
import { unreadCountFor, unreadCountsByCid } from './unread-counts';
import { peerRegistrationNotification, withRosterName } from './peer-registration-notification';
import { memberDisplayName } from '@/lib/member-names';
import { lazyOsDelivery, type OsDelivery } from './os-delivery';

export class NotificationService {
  private static instance: NotificationService;
  private notifications: Map<string, Notification> = new Map();
  private notificationHandlers: Set<NotificationHandler> = new Set();
  private unlisten: (() => void) | null = null;

  private constructor(private readonly deliverToOs: OsDelivery) {
    const offAdd: () => void = eventEmitter.on<Notification>('notification', (n) => this.addNotification(n));
    const offNames: () => void = eventEmitter.on('member-names:recorded', () => this.renameRequestsFromRoster());
    this.unlisten = (): void => { offAdd(); offNames(); };
    debugLog('NotificationService', 'NotificationService event listeners set up');
  }

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService(lazyOsDelivery);
    }
    return NotificationService.instance;
  }

  public addNotification(notification: Omit<Notification, 'id' | 'timestamp' | 'read'>): Notification {
    const fullNotification: Notification = {
      ...notification, id: uuidv4(), timestamp: Date.now(), read: false
    };
    this.notifications.set(fullNotification.id, fullNotification);
    this.notifyHandlers(fullNotification);
    this.notifyUnreadChange();

    // Whether the window is in front is read NOW, as the notification arrives; the
    // delivery (who owns it, the OS surface, the chime) loads with the first one, off
    // the landing page's critical path (check-bundle-budget.mjs).
    if (fullNotification.inAppOnly !== true && mayInterruptTheOs()) {
      void this.deliverToOs(fullNotification)
        .catch((error: unknown): void => { errorLog('NotificationService', 'could not reach the OS notification surface', error); });
    }

    return fullNotification;
  }

  public addMessageNotification(
    title: string, content: string, senderId: string,
    messageId: string, recipientCid?: string, data?: Record<string, unknown>
  ): Notification {
    return this.addNotification({
      type: NotificationType.MESSAGE, title, content, senderId,
      sourceId: messageId, recipientCid, priority: NotificationPriority.NORMAL, data
    });
  }

  public addPeerRegistrationNotification(
    peerUsername: string, peerCid: string, requestId: string,
    onAccept: () => void, onDecline: () => void, onCardClick: () => void,
    recipientCid?: string
  ): Notification {
    return this.addNotification(
      peerRegistrationNotification({
        peerUsername, peerCid, requestId, onAccept, onDecline, onCardClick, recipientCid,
      }),
    );
  }

  private renameRequestsFromRoster(): void {
    for (const n of this.notifications.values()) {
      const renamed: Notification | null = withRosterName(n, memberDisplayName);
      if (renamed) { this.notifications.set(renamed.id, renamed); this.notifyHandlers(renamed); }
    }
  }

  public addSystemNotification(
    title: string, content: string,
    priority: NotificationPriority = NotificationPriority.NORMAL,
    recipientCid?: string
  ): Notification {
    return this.addNotification({
      type: NotificationType.SYSTEM, title, content, priority, recipientCid
    });
  }

  public markAsRead(notificationId: string): void {
    const notification: Notification | undefined = this.notifications.get(notificationId);
    if (notification && !notification.read) {
      notification.read = true;
      this.notifications.set(notificationId, notification);
      this.notifyHandlers(notification);
      this.notifyUnreadChange();
    }
  }

  /**
   * Mark every notification read, across every session.
   *
   * Almost never what a caller wants. The panel is per-session, so use
   * `markAllAsReadForCid`; this exists for a genuine sign-out-everything sweep.
   */
  public markAllAsRead(): void {
    this.markRead(everything);
  }

  /**
   * Mark read only what the given session can see.
   *
   * The panel is correctly CID-scoped, but its two-second auto-read called the
   * service-wide sweep — so opening the bell in one workspace cleared the unread
   * badges of every OTHER session in the OrphanSessionsNavbar. Worst on the
   * logged-out landing page, where `sessionCid` is null: the panel renders "No
   * notifications" and two seconds later every session's badge is gone.
   *
   * Uses `notificationBelongsTo`, the same predicate the panel filters with, so
   * "what was shown" and "what was marked read" cannot disagree.
   */
  public markAllAsReadForCid(cid: string | null): void {
    this.markRead(belongingTo(cid));
  }

  private markRead(
    shouldMark: ReadPredicate,
    // The by-sender sweep never notified the per-notification handlers and the
    // panel sweeps always did. Preserved rather than unified, because changing
    // it would re-render every subscriber on every read receipt.
    { notifyHandlers = true }: { notifyHandlers?: boolean } = {},
  ): void {
    // Re-deliver only what this sweep actually changed. The store is
    // insert-only in normal operation (`cleanup()` has no callers), so
    // notifying every stored notification per sweep re-delivered the entire
    // ever-growing history to every handler each time a bell was opened.
    const changed: Notification[] = [];
    for (const [id, notification] of this.notifications.entries()) {
      if (!notification.read && shouldMark(notification)) {
        notification.read = true;
        this.notifications.set(id, notification);
        changed.push(notification);
      }
    }
    if (notifyHandlers) {
      for (const notification of changed) { this.notifyHandlers(notification); }
    }
    if (changed.length > 0) { this.notifyUnreadChange(); }
  }

  public markMessageNotificationsAsReadBySender(senderId: string): void {
    this.markRead(messagesFrom(senderId), { notifyHandlers: false });
  }
  /** A channel's messages are on screen: its bell entries are read. */
  public markGroupNotificationsAsRead(groupId: string): void { this.markRead(messagesInGroup(groupId)); }

  public removeNotification(notificationId: string): void {
    const notification: Notification | undefined = this.notifications.get(notificationId);
    if (notification) {
      const wasUnread: boolean = !notification.read;
      this.notifications.delete(notificationId);
      this.notifyRemovedHandler(notification);
      if (wasUnread) { this.notifyUnreadChange(); }
    }
  }

  public getNotifications(): Notification[] {
    return Array.from(this.notifications.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  public getUnreadNotifications(): Notification[] {
    return this.getNotifications().filter(n => !n.read);
  }

  public getNotificationsByType(type: NotificationType): Notification[] {
    return this.getNotifications().filter(n => n.type === type);
  }

  /**
   * The notifications that belong to `cid`, plus those belonging to no session.
   *
   * `recipientCid` was recorded on every notification and plumbed through to
   * `getUnreadCountByCid` — and the panel that actually renders them ignored it
   * entirely, filtering only by type. Message notifications carry a
   * 100-character plaintext preview and the sender's name, so a tab that
   * switched accounts (the workspace-switcher / ClaimSession flow this product
   * is built around) showed the previous account's messages to the new one.
   * `cleanup()` has no callers, so nothing clears them on logout either.
   *
   * Undefined `recipientCid` means "not session-scoped" and is always shown.
   */
  public getNotificationsForCid(cid: string | null): Notification[] {
    return this.getNotifications().filter((n) => notificationBelongsTo(n, cid));
  }

  public getUnreadCountByCid(cid: string): number {
    return unreadCountFor(this.notifications.values(), cid);
  }

  public getUnreadCountsByCid(): Map<string, number> {
    return unreadCountsByCid(this.notifications.values());
  }

  public notifyUnreadChange(): void {
    const notifications: Notification[] = Array.from(this.notifications.values());
    const unread: Notification[] = notifications.filter(n => !n.read);
    const change: UnreadCountChange = {
      total: unread.length,
      messages: unread.filter(n => n.type === NotificationType.MESSAGE).length,
      peerRegistrations: unread.filter(n => n.type === NotificationType.PEER_REGISTRATION).length,
      system: unread.filter(n => n.type === NotificationType.SYSTEM).length,
      byCid: this.getUnreadCountsByCid()
    };
    eventEmitter.emit('unread-count-changed', change);
  }

  public registerNotificationHandler(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => { this.notificationHandlers.delete(handler); };
  }

  private notifyHandlers(notification: Notification): void {
    notifyEach(this.notificationHandlers, 'notification', notification);
  }

  private notifyRemovedHandler(notification: Notification): void {
    notifyEach(this.notificationHandlers, 'notification-removed', {
      ...notification,
      id: `removed:${notification.id}`,
    });
  }

  public cleanup(): void {
    if (this.unlisten) { this.unlisten(); this.unlisten = null; }
    this.notificationHandlers.clear();
  }
}

export const notificationService: NotificationService = NotificationService.getInstance();
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  window.notificationService = notificationService;
}
