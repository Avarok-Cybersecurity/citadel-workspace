/**
 * The workspace's Settings list each app's notification settings under Notifications: the
 * Calendar's, loaded when the tab is opened. With no one signed in to a workspace there is no
 * Calendar to read them from, and the section says so rather than showing a form it cannot save.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsModal } from '@/components/SettingsModal';

describe("an app's notification settings", () => {
  it('are listed under Notifications, by app', async () => {
    render(<SettingsModal open onOpenChange={() => {}} tab="notifications" />);
    expect(screen.getByRole('tab', { name: 'Notifications' }).getAttribute('aria-selected')).toBe('true');
    const section: HTMLElement = await screen.findByRole('region', { name: 'Calendar' });
    expect(await screen.findByText("Open a workspace to change the Calendar's notifications.")).toBeTruthy();
    expect(section.contains(screen.getByText("Open a workspace to change the Calendar's notifications."))).toBe(true);
  });
});
