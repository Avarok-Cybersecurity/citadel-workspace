/**
 * Notification Service Module
 *
 * Re-exports all public API for the notification system.
 */

// Types
export type {
  UnreadCountChange,
  Notification,
  NotificationAction,
  NotificationHandler,
} from './types';
export {
  NotificationType,
  NotificationPriority,
} from './types';

// Service
export {
  NotificationService,
  notificationService,
} from './service';

export default NotificationService;

import { NotificationService } from './service';
