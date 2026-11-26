/**
 * Where an app's notifications may go beyond the page's list: the member's choice, which the app
 * keeps in its own storage and records here each time it reads it, before it raises a notice. This
 * tab's copy, never a second store. A member who sends them to this device gets them in the
 * system's notification centre whenever they arrive, in front or not, as a calendar app shows its
 * reminders; one who keeps them to the page never does. An app that never records leaves the
 * page's rule for everything else: the system only while the window is not in front.
 */
import type { OsReach } from '@/lib/notification-service/types';

const chosen: Map<string, OsReach> = new Map<string, OsReach>();

export function recordAppNoticeDelivery(appId: string, system: boolean): void {
  chosen.set(appId, system ? 'always' : 'never');
}

export function appOsReach(appId: string): OsReach {
  return chosen.get(appId) ?? 'when-away';
}
