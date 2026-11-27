/**
 * The member's Calendar notification settings over a Calendar's ports: in the Calendar's own
 * "Notifications" panel and under Apps in the workspace's Settings (NotificationSettings.tsx).
 * This browser's notification permission is read here, at the edge (use-os-permission.ts).
 */
import { NotificationSettings } from './NotificationSettings';
import { useOsPermission, type OsPermissionState } from '@/components/notification/use-os-permission';
import { useNotifyPrefs, type PrefsState } from './use-notify-prefs';
import { UnreadablePanel } from './UnreadablePanel';
import type { CalendarPorts } from '@/lib/calendar/ports';

export function CalendarNotifications({ ports }: { ports: CalendarPorts }): JSX.Element {
  const state: PrefsState = useNotifyPrefs(ports);
  const os: OsPermissionState = useOsPermission();
  if (state.kind === 'loading') return <p role="status" className="text-sm text-muted-foreground">Loading your notification settings…</p>;
  if (state.kind === 'failed') return <UnreadablePanel what="Your notification settings" reason={state.reason} retry={state.retry} />;
  return <NotificationSettings state={state} os={os} />;
}
