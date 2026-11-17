/**
 * The member's notification settings applied to everything the Calendar raises (notify-prefs.ts):
 * before each notice, their settings are read again from their own storage, so a change made in
 * another window holds at once and there is no copy to fall out of date. A kind they turned off,
 * or the Calendar turned off, raises nothing; whether a notice may also reach the system is
 * recorded with the page before it is raised (citadel-apps/app-notice-delivery.ts).
 */
import { decodePrefs, NOTIFY_PREFS_KEY, PREFS_BEFORE_CHOICE, allows, type NoticeKind, type NotifyPrefs } from './notify-prefs';
import type { CalendarPorts, CalendarStorage } from './ports';

/** The member's settings as kept; what applies before they choose; unreadable ones are said, then treated as unchosen. */
export async function readPrefs(storage: Pick<CalendarStorage, 'get'>): Promise<NotifyPrefs> {
  const bytes: Uint8Array | null = await storage.get({ kind: 'user' }, NOTIFY_PREFS_KEY);
  if (bytes === null) return PREFS_BEFORE_CHOICE;
  const prefs: NotifyPrefs | null = decodePrefs(bytes);
  if (prefs === null) console.error('[calendar] the notification settings could not be read, so the ones before a choice apply');
  return prefs ?? PREFS_BEFORE_CHOICE;
}

/** `record`: whether this member lets the Calendar's notices reach the system, told before each one is raised. */
export function withNoticePrefs(ports: CalendarPorts, record: (system: boolean) => void): CalendarPorts {
  return {
    ...ports,
    notify: async (kind: NoticeKind, title: string, body: string): Promise<void> => {
      const prefs: NotifyPrefs = await readPrefs(ports.storage);
      if (!allows(prefs, kind)) return;
      record(prefs.delivery === 'system');
      await ports.notify(kind, title, body);
    },
  };
}
