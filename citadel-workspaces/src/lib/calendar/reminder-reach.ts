/**
 * When the member's reminders reach them, in words, wherever reminders are chosen. Three cases:
 * - The agent keeps them (it takes app notices) and its menu-bar app listens: they arrive on
 *   time with no window open.
 * - The agent keeps them but nothing on its side shows them: one that falls due with no window
 *   open waits, and is shown marked missed when a window next opens.
 * - No agent keeps them: they fire only while a window is open, and those missed meanwhile are
 *   listed once on return (reminder-runner.ts).
 * Invitations and polls are told by a window in every case (invite-notices.ts).
 */
export type ReminderReach = 'on-time' | 'held' | 'window-only';

/** `takes`: the agent takes app notices (capabilities.ts `appNotices`); `heard`: its notifier listens (`noticesHeard`). */
export function reminderReach(takes: boolean, heard: boolean): ReminderReach {
  if (!takes) return 'window-only';
  return heard ? 'on-time' : 'held';
}

/** What the reminder picker says under its choices. */
export const PICKER_COPY: Readonly<Record<ReminderReach, string>> = {
  'on-time': 'A reminder arrives on time, even with no Citadel window open: the Citadel Agent shows it from the menu bar.',
  held: 'A reminder that falls due while none of your Citadel windows is open waits, and is shown, marked missed, when you next open one.',
  'window-only': 'A reminder arrives while one of your workspace windows is open, whichever page it shows. One that falls due while none is open is listed once in your notifications when you come back.',
};

/** What the Calendar's notification settings say about when notices run. */
export const SETTINGS_COPY: Readonly<Record<ReminderReach, string>> = {
  'on-time': 'Reminders arrive on time with no Citadel window open: the Citadel Agent shows them from the menu bar. Invitations and polls need one of your windows open; those made meanwhile are in the Calendar, without a notice.',
  held: 'The Citadel Agent keeps your reminders, but with no window open nothing on this computer shows them: one that falls due meanwhile is shown, marked missed, when you next open a window. Invitations and polls made meanwhile are in the Calendar, without a notice.',
  'window-only': 'Notices, reminders included, need one of your Citadel windows open: nothing runs while none is. A reminder that falls due while none is open is listed once when you return; invitations and polls made meanwhile are in the Calendar, without a notice.',
};
