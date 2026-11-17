/**
 * The Calendar's notification settings in the workspace's Settings: the member's own, read and
 * saved through the workspace's Calendar (WithCalendar.tsx), the same form the Calendar shows.
 */
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { CalendarNotifications } from '../CalendarNotifications';
import { WithCalendar, type CalendarReach } from './WithCalendar';

export default function CalendarNotificationsHere(): JSX.Element {
  const { state } = useWorkspace();
  const me: string | null = state.currentUser?.username ?? null;
  if (me === null) return <p className="text-sm text-muted-foreground">Open a workspace to change the Calendar's notifications.</p>;
  return (
    <WithCalendar me={me} purpose="settings">
      {(reach: CalendarReach) => {
        if (reach.kind === 'waiting') return <p role="status" className="text-sm text-muted-foreground">Loading the Calendar…</p>;
        if (reach.kind === 'absent') return <p className="text-sm text-muted-foreground">{reach.why}</p>;
        return <CalendarNotifications ports={reach.ports} />;
      }}
    </WithCalendar>
  );
}
