/**
 * This browser's notification permission, at the edge: read it, ask for it, and remember that a
 * notice meant for the system was held because of it.
 *
 * Asking is only ever done from a click (OsNotificationsControl.tsx, and choosing "on this device"
 * in the Calendar's settings). Safari and Firefox ignore a request made without one, and Chrome
 * may quiet it; the delivery path used to ask from a reminder's timer, often in a hidden window,
 * so permission stayed unasked and every system notification was dropped without a word.
 */
import { createValueStore, type ValueStore } from '@/lib/value-store';
import type { OsPermission } from './os-decision';

export function readOsPermission(): OsPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Call from a click handler only: the browser's prompt, and its answer. */
export async function askOsPermission(): Promise<OsPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  const answer: NotificationPermission = await Notification.requestPermission();
  if (answer === 'granted') heldForTheOs.set(false);
  return answer;
}

/**
 * A notice meant for the system was held this session because permission is missing or refused:
 * the bell then shows what to do about it. Cleared once permission is granted.
 */
export const heldForTheOs: ValueStore<boolean> = createValueStore<boolean>('notifications-held-for-the-os', false);
