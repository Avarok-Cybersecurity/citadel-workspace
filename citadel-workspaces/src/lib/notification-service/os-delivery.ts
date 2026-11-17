/**
 * The OS notification's delivery, as a port of the notification service.
 *
 * Production's is the lazy chunk (interrupt-os.ts), loaded with the first
 * notification so it stays off the landing page's critical path
 * (check-bundle-budget.mjs lists it among the modules that must). A port, so
 * the delivery the service starts is a promise something can wait on.
 */
import type { Notification } from './types';

export type OsDelivery = (notification: Notification) => Promise<void>;

export const lazyOsDelivery: OsDelivery = (notification: Notification): Promise<void> =>
  import('./interrupt-os').then(({ interruptTheOs }) => interruptTheOs(notification));
