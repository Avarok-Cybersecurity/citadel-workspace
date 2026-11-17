import { useState, useEffect, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import NotificationService, { 
  Notification, 
  NotificationType 
} from '@/lib/notification-service';
import NotificationItem from '@/components/notification/NotificationItem';
import { notificationBelongsTo } from '@/lib/notification-service/types';
import { connectionManager } from '@/lib/connection';
import { eventEmitter } from '@/lib/event-emitter';
import { conversationHref } from '@/components/layout/sidebar/active-conversation';
import { useLinkTargetOpener } from './use-link-target';
import { useLocation, type Location } from 'react-router-dom';
import { useGuardedNavigate, type GuardedNavigate } from '@/hooks/use-guarded-navigate';

const NotificationCenter: () => JSX.Element = (): JSX.Element => {
  const [open, setOpen] = useState(false);
  const openPanel: () => void = useCallback((): void => setOpen(true), []);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | NotificationType>('all');
  const [sessionCid, setSessionCid] = useState<string | null>(null);
  const navigate: GuardedNavigate = useGuardedNavigate();
  const location: Location = useLocation();

  // The third end of the message-notification click.
  //
  // The card supplies a callback that emits this; nothing listened, so even
  // once the card became clickable the click still went nowhere. Navigating
  // here rather than inside lib/ keeps the messaging layer free of the router,
  // which is why the event exists at all.
  useEffect(() => {
    return eventEmitter.on<{ peerCid: bigint; peerUsername: string }>(
      'p2p:open-conversation',
      (payload): void => {
        setOpen(false);
        void navigate(
          conversationHref(location.pathname, location.search, {
            cid: payload.peerCid.toString(),
            username: payload.peerUsername,
          }),
        );
      },
    );
  }, [navigate, location.pathname, location.search]);
  useLinkTargetOpener(openPanel);

  const notificationService: NotificationService = NotificationService.getInstance();
  
  // Get counts of different notification types
  const unreadCount: number = notifications.filter(n => !n.read).length;
  const messageCount: number = notifications.filter(n => n.type === NotificationType.MESSAGE && !n.read).length;
  const requestCount: number = notifications.filter(n => n.type === NotificationType.PEER_REGISTRATION && !n.read).length;
  const systemCount: number = notifications.filter(n => n.type === NotificationType.SYSTEM && !n.read).length;
  
  useEffect(() => {
    // Polled, matching CallLayer: connection identity settles asynchronously
    // during login, and a notification list scoped to a CID we do not have yet
    // would be empty rather than wrong.
    const read = (): void => setSessionCid(connectionManager.getConnectionInfo()?.cid?.toString() ?? null);
    read();
    const timer: number = window.setInterval(read, 2000);
    return (): void => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    // Scoped to THIS session. The panel used to render every notification the
    // singleton store held, and message notifications carry a 100-character
    // plaintext preview and the sender's name — so a tab that switched accounts
    // showed the previous account's messages to the new one, and markAllAsRead
    // marked them read as the new account.
    setNotifications(notificationService.getNotificationsForCid(sessionCid));
    
    // Register for notification updates
    const unregister: () => void = notificationService.registerNotificationHandler((notification): void => {
      // Check if this is a removed notification
      if (notification.id.startsWith('removed:')) {
        const actualId: string = notification.id.replace('removed:', '');
        setNotifications(prev => prev.filter(n => n.id !== actualId));
        return;
      }
      
      // The same predicate as the initial load. Filtering one and not the other
      // leaks in exactly the same way as filtering neither.
      if (!notificationBelongsTo(notification, sessionCid)) return;

      setNotifications(prev => {
        // Check if we already have this notification
        const existingIndex: number = prev.findIndex(n => n.id === notification.id);
        if (existingIndex >= 0) {
          // Update existing notification
          const updated: Notification[] = [...prev];
          updated[existingIndex] = notification;
          return updated;
        } else {
          // Add new notification
          return [notification, ...prev];
        }
      });
    });
    
    // Delay marking as read so the user actually sees the notifications first
    let readTimeout: ReturnType<typeof setTimeout> | null = null;
    if (open) {
      readTimeout = setTimeout(() => {
        // Scoped to THIS session. The service-wide sweep cleared every other
        // session's badge in the navbar -- and on the landing page, where
        // sessionCid is null and the panel shows "No notifications", it cleared
        // all of them two seconds after opening an empty bell.
        notificationService.markAllAsReadForCid(sessionCid);
      }, 2000);
    }
    
    return (): void => {
      unregister();
      if (readTimeout) clearTimeout(readTimeout);
    };
  }, [open, notificationService, sessionCid]);
  
  // Filter notifications based on the active tab
  const filteredNotifications: Notification[] = activeTab === 'all' 
    ? notifications 
    : notifications.filter(n => n.type === activeTab);
  
  const handleClearAll = (): void => {
    const notificationIds: string[] = filteredNotifications.map(n => n.id);
    notificationIds.forEach(id => notificationService.removeNotification(id));
  };
  
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {/* aria-label, because the only content is an icon and a count.
            The badge's number is not a name — it says how many, not what the
            control does — and axe reports the button as having no discernible
            text. Folding the count into the label means a screen reader
            announces "Notifications, 3 unread" rather than "3, button". */}
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          // Addressed by id. A spec reached for it as
          // `button:has(svg.lucide-bell)` -- an icon library's internal class
          // name, which nothing promises to keep.
          data-testid="notification-bell"
          aria-label={
            unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
          }
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              // aria-hidden: the count is already in the button's label, and
              // announcing it twice is noise.
              aria-hidden="true"
              // Named, because the spec addressed it as
              // `button:has(svg.lucide-bell) .absolute` -- an icon library's
              // internal class and a Tailwind utility. The responsive spec's
              // own comment says nothing promises to keep `lucide-bell`, and
              // `.absolute` changes with any positioning tweak.
              data-testid="notification-badge"
              className="absolute -top-2 -right-2 px-1.5 min-w-5 h-5 flex items-center justify-center"
            >
              {unreadCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      {/* w-full below sm, not w-[400px]: an unprefixed fixed width is wider than a
          375px phone, and because the sheet is position:fixed it does not widen the
          document -- it simply hangs 25px off-screen to the left, taking the
          heading's padding with it. No overflow check can see that; the panel looks
          like it has no left margin at all. The Sheet primitive defaults to a
          responsive w-3/4 sm:max-w-sm, which this override discarded. */}
      <SheetContent className="w-full sm:w-[540px] bg-card/85 backdrop-blur-xl backdrop-saturate-150 text-foreground border-border">
        <SheetHeader className="border-b border-border pb-4">
          {/* pr-8 clears the Sheet's own close button, which sits absolute at top-right. */}
          <div className="flex items-center justify-between pr-8">
            <SheetTitle className="text-foreground">Notifications</SheetTitle>
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-foreground/80"
              onClick={handleClearAll}
            >
              {activeTab === 'all' ? 'Clear All' : 'Clear Shown'}
            </Button>
          </div>
        </SheetHeader>
        
        <Tabs defaultValue="all" value={activeTab} onValueChange={(value) => setActiveTab(value as 'all' | NotificationType)}>
          <TabsList className="grid grid-cols-4 mt-4 mb-6 bg-card">
            <TabsTrigger value="all" className="data-[state=active]:bg-surface data-[state=active]:text-foreground">
              All {unreadCount > 0 && `(${unreadCount})`}
            </TabsTrigger>
            <TabsTrigger value={NotificationType.MESSAGE} className="data-[state=active]:bg-surface data-[state=active]:text-foreground">
              Messages {messageCount > 0 && `(${messageCount})`}
            </TabsTrigger>
            <TabsTrigger value={NotificationType.PEER_REGISTRATION} className="data-[state=active]:bg-surface data-[state=active]:text-foreground">
              Requests {requestCount > 0 && `(${requestCount})`}
            </TabsTrigger>
            <TabsTrigger value={NotificationType.SYSTEM} className="data-[state=active]:bg-surface data-[state=active]:text-foreground">
              System {systemCount > 0 && `(${systemCount})`}
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value={activeTab} className="mt-0">
            <ScrollArea className="h-[calc(100dvh-180px)]">
              {filteredNotifications.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  No notifications to display
                </div>
              ) : (
                <div className="space-y-2 pr-4">
                  {filteredNotifications.map(notification => (
                    <NotificationItem 
                      key={notification.id} 
                      notification={notification} 
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
};

export default NotificationCenter;
