/**
 * The page's side of system notifications (OsNotificationsControl.tsx, BellOsPrompt.tsx): the
 * bell says nothing until a notice for this device was held; then it offers "Allow notifications",
 * whose click is the only place the browser is asked. Blocked, it says how to unblock and offers
 * no button that cannot work. Allowed, a test notification reports what the browser said: shown,
 * or not, with where to look on the system. Over a fake Notification API (CI cannot drive the OS).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { heldForTheOs } from '@/lib/notification-service/os-permission';
import { installFakeNotificationApi, type FakeNotificationApi } from '@/lib/notification-service/__tests__/fake-notification-api';
import { BellOsPrompt } from '../BellOsPrompt';
import { OsNotificationsControl } from '../OsNotificationsControl';
import { useOsPermission, type OsPermissionState } from '../use-os-permission';

function Settings(): JSX.Element {
  const os: OsPermissionState = useOsPermission();
  return <OsNotificationsControl permission={os.permission} ask={os.ask} />;
}

afterEach(() => { vi.unstubAllGlobals(); act(() => heldForTheOs.set(false)); });

describe('the bell', () => {
  it('says nothing about system notifications until a notice for this device was held', () => {
    installFakeNotificationApi('default');
    render(<BellOsPrompt />);
    expect(screen.queryByTestId('os-notifications-control')).toBeNull();
    act(() => heldForTheOs.set(true));
    expect(screen.getByRole('button', { name: 'Allow notifications' })).toBeTruthy();
  });

  it('asks the browser on the click, and goes quiet once allowed', async () => {
    const api: FakeNotificationApi = installFakeNotificationApi('default');
    act(() => heldForTheOs.set(true));
    render(<BellOsPrompt />);
    expect(api.asked()).toBe(0);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Allow notifications' })); });
    expect(api.asked()).toBe(1);
    expect(screen.queryByTestId('os-notifications-control')).toBeNull();
  });

  it('keeps offering it when the member says no at the prompt', async () => {
    const api: FakeNotificationApi = installFakeNotificationApi('default');
    api.answer = 'denied';
    act(() => heldForTheOs.set(true));
    render(<BellOsPrompt />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Allow notifications' })); });
    expect(screen.getByRole('alert').textContent).toMatch(/blocks notifications from this site.*site's settings/);
    expect(screen.queryByRole('button', { name: 'Allow notifications' })).toBeNull();
  });
});

describe('allowed, a test notification', () => {
  it('reports that the browser showed it, and where to look if it did not appear', async () => {
    const api: FakeNotificationApi = installFakeNotificationApi('granted');
    render(<Settings />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send a test notification' })); });
    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/says it showed/));
    expect(api.shown).toEqual(['Citadel notifications are on']);
    expect(screen.getByRole('status').textContent).toMatch(/System Settings → Notifications/);
  });

  it('says plainly when the browser could not show it', async () => {
    const api: FakeNotificationApi = installFakeNotificationApi('granted');
    api.outcome = 'error';
    render(<Settings />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send a test notification' })); });
    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/could not show a test notification\. Check .*System Settings → Notifications/));
  });

  it('picks up a permission changed in the browser when the window comes back', () => {
    const api: FakeNotificationApi = installFakeNotificationApi('denied');
    render(<Settings />);
    expect(screen.queryByRole('button', { name: 'Send a test notification' })).toBeNull();
    api.setPermission('granted');
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(screen.getByRole('button', { name: 'Send a test notification' })).toBeTruthy();
  });
});
