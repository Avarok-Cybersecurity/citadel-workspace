/**
 * Whether an app's notifications may reach the system's notification centre, or stay in the
 * page's list: the member's choice, which the app keeps in its own storage and records here each
 * time it reads it, before it raises a notice. This tab's copy, never a second store: an app that
 * never records leaves the page's own rule (in-front.ts) to decide, as every notification does.
 */
const inAppOnly: Set<string> = new Set<string>();

export function recordAppNoticeDelivery(appId: string, system: boolean): void {
  if (system) inAppOnly.delete(appId);
  else inAppOnly.add(appId);
}

export function appMayReachTheSystem(appId: string): boolean {
  return !inAppOnly.has(appId);
}
