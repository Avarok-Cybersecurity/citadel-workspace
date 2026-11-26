/** When the member's reminders reach them, kept current as the agent says what it takes (reminder-reach.ts). */
import { useSyncExternalStore } from 'react';
import { appNotices, noticesHeard } from '@/lib/agent-conversations/capabilities';
import { reminderReach, type ReminderReach } from '@/lib/calendar/reminder-reach';

export function useReminderReach(): ReminderReach {
  const takes: boolean = useSyncExternalStore(appNotices.subscribe, appNotices.get);
  const heard: boolean = useSyncExternalStore(noticesHeard.subscribe, noticesHeard.get);
  return reminderReach(takes, heard);
}
