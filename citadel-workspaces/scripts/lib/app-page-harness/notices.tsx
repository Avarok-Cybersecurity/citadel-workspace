/**
 * The page's notification list as the app-page harness shows it: the shipped NotificationItem
 * cards for this session's entries in the shipped notification service, and the shipped opener
 * (use-app-notice-opener.ts) that turns a card's `apps:open-node` into opening the node, under a
 * router whose location the check reads. NotificationCenter itself is not mounted: its list is
 * scoped by connectionManager's connection info, which only a signed-in socket sets; the cards,
 * the service, the event and the opener are the ones it composes.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation, type Location } from 'react-router-dom';
import NotificationItem from '@/components/notification/NotificationItem';
import { useAppNoticeOpener } from '@/components/notification/use-app-notice-opener';
import { notificationService } from '@/lib/notification-service/service';
import type { Notification } from '@/lib/notification-service/types';

/** What check-app-page.mjs reads of the notification side. */
export interface NoticeProbe {
  /** Every entry for this session: who it is from, its title and its text. */
  entries: { from: string; title: string; body: string }[];
  /** The router's location after the last navigation. */
  location: string;
}

export function NoticeList({ cid, probe }: { cid: string; probe: NoticeProbe }): JSX.Element | null {
  const read = useCallback((): Notification[] => notificationService.getNotificationsForCid(cid), [cid]);
  const [items, setItems] = useState<Notification[]>(read);
  useEffect(() => notificationService.registerNotificationHandler((): void => setItems(read())), [read]);
  useEffect(() => {
    probe.entries = items.map((n: Notification) => ({ from: n.senderName ?? '', title: n.title, body: n.content }));
  }, [items, probe]);
  if (items.length === 0) return null;
  return (
    <section aria-label="Notifications" data-testid="harness-notices" className="space-y-2 border-t border-border bg-card"
      // Inline: Tailwind generates only the classes it finds under src/. Over the pane's foot, as the panel opens over a page.
      style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 10, maxHeight: '40vh', overflow: 'auto', padding: '8px' }}>
      {items.map((n: Notification) => <NotificationItem key={n.id} notification={n} />)}
    </section>
  );
}

export function NoticeOpener({ probe }: { probe: NoticeProbe }): null {
  const location: Location = useLocation();
  useAppNoticeOpener(useCallback((): void => undefined, []));
  useEffect(() => { probe.location = `${location.pathname}${location.search}`; }, [location, probe]);
  return null;
}
