/**
 * Where an app's `notify` lands in the page (runtime/first-party-ports.ts `badgedNotifyPort`): an
 * entry in the notification list, from the app by name, for the session this tab acts as. With
 * two sessions in one browser a reminder belongs to the member whose app raised it, so it carries
 * that session's CID like any other notification; with no session there is no one to tell. A
 * member's choice of where an app's notices go (app-notice-delivery.ts) sets their system reach.
 * Activating the entry opens the node the instance is mounted on: the card asks for it on the bus
 * (`apps:open-node`) and the notification panel, which holds the router, opens it
 * (components/notification/use-app-notice-opener.ts), so this module stays free of the router.
 * The page's list lives in memory only: after a reload the entry is gone, and so is its link.
 */
import { eventEmitter } from '@/lib/event-emitter';
import { notificationService } from '@/lib/notification-service/service';
import { NotificationPriority, NotificationType, type Notification } from '@/lib/notification-service/types';
import { getCurrentCid } from '@/lib/p2p/current-cid';
import { appOsReach } from './app-notice-delivery';
import type { AppNoticeEntry, NoticeSink } from './runtime/first-party-ports';

/** What an app notification asks the page to open when activated: the node its instance is on. */
export interface AppNoticeTarget {
  readonly nodeId: string;
}

/** Opens the node an app notification is about, when its card is activated. */
export function openAppNode(nodeId: string): () => void {
  return (): void => {
    const target: AppNoticeTarget = { nodeId };
    eventEmitter.emit('apps:open-node', target);
  };
}

/** The list entry for an app's notice, for session `cid`. Pure: the sink below adds it. */
export function appNoticeNotification(notice: AppNoticeEntry, cid: bigint): Omit<Notification, 'id' | 'timestamp' | 'read'> {
  return {
    type: NotificationType.SYSTEM, priority: NotificationPriority.NORMAL,
    title: notice.title, content: notice.body, senderName: notice.from, recipient_cid: cid.toString(), data: {
      appId: notice.appId, nodeId: notice.nodeId, senderLine: notice.senderLine, onCardClick: openAppNode(notice.nodeId),
    },
    osReach: appOsReach(notice.appId),
  };
}

export const pageAppNotices: NoticeSink = (notice: AppNoticeEntry): void => {
  getCurrentCid().then((cid: bigint | null): void => {
    if (cid === null) {
      console.warn(`[apps] ${notice.from} raised a notification with no session signed in; it was not shown`);
      return;
    }
    notificationService.addNotification(appNoticeNotification(notice, cid));
  }, (error: unknown): void => { console.error(`[apps] ${notice.from}'s notification could not be shown`, error); });
};
