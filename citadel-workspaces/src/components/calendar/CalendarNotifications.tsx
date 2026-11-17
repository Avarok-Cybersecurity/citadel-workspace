/**
 * The member's Calendar notification settings over a Calendar's ports: in the Calendar's own
 * "Notifications" panel and under Apps in the workspace's Settings (NotificationSettings.tsx).
 * This browser's notification permission is read here, at the edge.
 */
import { NotificationSettings, type SystemPermission } from './NotificationSettings';
import { useNotifyPrefs, type PrefsState } from './use-notify-prefs';
import type { CalendarPorts } from '@/lib/calendar/ports';

const permissionHere = (): SystemPermission => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

export function CalendarNotifications({ ports }: { ports: CalendarPorts }): JSX.Element {
  const state: PrefsState = useNotifyPrefs(ports);
  if (state.kind === 'loading') return <p role="status" className="text-sm text-muted-foreground">Loading your notification settings…</p>;
  if (state.kind === 'failed') return <p role="alert" className="text-sm text-destructive-emphasis">Your notification settings could not be read: {state.reason}.</p>;
  return <NotificationSettings state={state} permission={permissionHere()} />;
}
