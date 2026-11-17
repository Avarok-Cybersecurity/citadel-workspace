/**
 * Where an app's `notify` lands in the page (runtime/first-party-ports.ts `badgedNotifyPort`): an
 * entry in the notification list, from the app by name, for the session this tab acts as. With
 * two sessions in one browser a reminder belongs to the member whose app raised it, so it carries
 * that session's CID like any other notification; with no session there is no one to tell. A
 * member who keeps an app's notices to the page (app-notice-delivery.ts) gets no system one.
 */
import { notificationService } from '@/lib/notification-service/service';
import { NotificationPriority, NotificationType } from '@/lib/notification-service/types';
import { getCurrentCid } from '@/lib/p2p/current-cid';
import { appMayReachTheSystem } from './app-notice-delivery';
import type { AppNotice, NoticeSink } from './runtime/first-party-ports';

export const pageAppNotices: NoticeSink = (notice: AppNotice): void => {
  getCurrentCid().then((cid: bigint | null): void => {
    if (cid === null) {
      console.warn(`[apps] ${notice.from} raised a notification with no session signed in; it was not shown`);
      return;
    }
    notificationService.addNotification({
      type: NotificationType.SYSTEM, priority: NotificationPriority.NORMAL,
      title: notice.title, content: notice.body, senderName: notice.from, recipientCid: cid.toString(), data: { appId: notice.appId },
      inAppOnly: !appMayReachTheSystem(notice.appId),
    });
  }, (error: unknown): void => { console.error(`[apps] ${notice.from}'s notification could not be shown`, error); });
};
