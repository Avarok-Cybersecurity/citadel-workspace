/**
 * Where reminders are chosen, the page says when they reach the member on this computer, as the
 * agent says now (reminder-reach.ts): on time with no window open when the agent keeps them and
 * its menu-bar app listens; marked missed at the next window when it keeps them with nothing to
 * show them; only while a window is open when no agent keeps them. Real stores and component.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { appNotices, noticesHeard } from '@/lib/agent-conversations/capabilities';
import { PICKER_COPY, reminderReach, SETTINGS_COPY } from '@/lib/calendar/reminder-reach';
import { ReminderPicker } from '../ReminderPicker';

afterEach(() => {
  cleanup();
  appNotices.set(false);
  noticesHeard.set(false);
});

describe('when reminders arrive', () => {
  it('follows what the agent keeps and whether anything on its side shows them', () => {
    expect(reminderReach(true, true)).toBe('on-time');
    expect(reminderReach(true, false)).toBe('held');
    expect(reminderReach(false, true)).toBe('window-only');
    expect(reminderReach(false, false)).toBe('window-only');
  });

  it('is said in the reminder picker, and changes as the agent answers', () => {
    render(<ReminderPicker chosen={[]} onChange={(): void => undefined} />);
    expect(screen.getByText(PICKER_COPY['window-only'])).toBeTruthy();
    act(() => { appNotices.set(true); });
    expect(screen.getByText(PICKER_COPY.held)).toBeTruthy();
    act(() => { noticesHeard.set(true); });
    expect(screen.getByText(PICKER_COPY['on-time'])).toBeTruthy();
  });

  it('never promises a reminder with no window open unless something shows it', () => {
    expect(PICKER_COPY.held).toMatch(/missed/);
    expect(SETTINGS_COPY.held).toMatch(/missed/);
    expect(PICKER_COPY['window-only']).not.toMatch(/no Citadel window open/);
    expect(SETTINGS_COPY['on-time']).toMatch(/no Citadel window open/);
  });
});
