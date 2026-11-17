import { useState } from 'react';
import { MessageSquare, Users, Bell, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MemberAvatar } from '@/components/shared/MemberAvatar';
import { cn } from '@/lib/utils';
import NotificationService, { 
  Notification, 
  NotificationType 
} from '@/lib/notification-service';
import { formatRelative, formatDateTime } from '@/lib/format-time';

interface NotificationItemProps {
  notification: Notification;
}

const NotificationItem: ({ notification }: NotificationItemProps) => JSX.Element = ({ notification }: NotificationItemProps): JSX.Element => {
  const [isExpanded, setIsExpanded] = useState(false);
  const notificationService: NotificationService = NotificationService.getInstance();
  
  // Mark as read when rendered
  if (!notification.read) {
    notificationService.markAsRead(notification.id);
  }
  
  const handleDismiss = (): void => {
    notificationService.removeNotification(notification.id);
  };
  
  // Format the timestamp
  const formattedTime: string = formatRelative(notification.timestamp);
  const exactTime: string = formatDateTime(notification.timestamp);
  
  // Get the appropriate icon based on notification type
  const getNotificationIcon: () => JSX.Element = (): JSX.Element => {
    switch (notification.type) {
      case NotificationType.MESSAGE:
        return <MessageSquare className="h-4 w-4" />;
      case NotificationType.PEER_REGISTRATION:
        return <Users className="h-4 w-4" />;
      case NotificationType.SYSTEM:
        return <Bell className="h-4 w-4" />;
      default:
        return <Bell className="h-4 w-4" />;
    }
  };
  
  // Priority shows on the leading chip only.
  const chipTone: () => string = (): string => {
    switch (notification.priority) {
      case 'high':
        return 'text-destructive';
      case 'normal':
        return 'text-primary-accent';
      default:
        return 'text-muted-foreground';
    }
  };

  // Handle card click (for PEER_REGISTRATION cards, opens the modal)
  const handleCardClick = (e: React.MouseEvent): void => {
    // Don't trigger if clicking buttons or the dismiss X
    if ((e.target as HTMLElement).closest('button')) return;

    // Narrowed, not assumed. `data` is `Record<string, unknown>` -- it arrives
    // from whoever raised the notification -- so a callback in it is a claim
    // until it is checked. It used to be typed `any`, which let this call
    // anything at all under that key, including a string.
    const onCardClick: unknown = notification.data?.onCardClick;
    if (typeof onCardClick === 'function') {
      (onCardClick as () => void)();
    }
  };

  // This decides the CURSOR, not the behaviour: `handleCardClick` above runs
  // unconditionally and does or does not find a callback. It used to also
  // require `type === PEER_REGISTRATION`, so a message card that did something
  // when clicked gave the reader no sign that it would -- an affordance
  // missing from a control that worked. (What made the click itself dead was a
  // key mismatch: the message pipeline supplied `onOpen`.)
  const isClickable: boolean = typeof notification.data?.onCardClick === 'function';

  // A flat row, not a framed card. getBorderColor used to paint the WHOLE 1px
  // border with the priority colour on top of a 4px left bar and the Card's
  // shadow, so every notice sat in a glowing outline. Priority now tints only
  // the leading chip; the row itself is neutral.
  return (
    <Card
      onClick={handleCardClick}
      data-priority={notification.priority}
      className={cn(
        'group relative flex gap-3 rounded-lg border border-border bg-surface px-3.5 py-3 text-foreground shadow-none transition-colors duration-150',
        isClickable && 'cursor-pointer hover:border-primary-accent/40 hover:bg-muted/40',
      )}
    >
      {notification.senderName ? (
        // Decorative: the notification title carries the sender. Initials come from the name --
        // the id is a CID, and its first two digits read as "53".
        <MemberAvatar username={notification.senderName} name={notification.senderName} className="h-9 w-9" />
      ) : (
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted', chipTone())} aria-hidden="true">
          {getNotificationIcon()}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold leading-5 text-foreground">
            {notification.title}
          </h3>
          <time
            className="shrink-0 text-xs leading-5 text-muted-foreground"
            dateTime={new Date(notification.timestamp).toISOString()}
            title={exactTime}
          >
            {formattedTime}
          </time>
          <Button
            variant="ghost"
            size="icon"
            className="tap-target -mr-1 h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground reveal-on-hover"
            onClick={handleDismiss}
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>

        <p className={cn('mt-0.5 break-words text-sm leading-5 text-foreground/80', !isExpanded && 'line-clamp-2')}>
          {notification.content}
        </p>

        {notification.content.length > 100 && (
          <Button
            variant="link"
            size="sm"
            className="mt-1 h-auto p-0 text-xs text-primary-accent"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? 'Show less' : 'Show more'}
          </Button>
        )}

        {notification.actionButtons && notification.actionButtons.length > 0 && (
          <div className="mt-3 flex justify-end gap-2">
            {notification.actionButtons.map(action => (
              <Button
                key={action.id}
                variant={action.variant || 'default'}
                size="sm"
                onClick={() => {
                  action.onClick();
                  handleDismiss();
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};

export default NotificationItem;
