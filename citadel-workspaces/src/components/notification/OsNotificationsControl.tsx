/**
 * Whether Citadel's notices can reach this device's notification centre, and what to do about it:
 * allow them (a click, so the browser will ask), how to unblock them, or, once allowed, a test
 * notification and what the browser said became of it (os-test-notification.ts). Shown in the
 * Calendar's notification settings, and in the bell once a notice meant for the system was held.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { sendTestNotification, type TestOutcome } from '@/lib/notification-service/os-test-notification';
import type { OsPermission } from '@/lib/notification-service/os-decision';

const SYSTEM_SETTINGS: string = "your system's notification settings for this browser (on a Mac: System Settings → Notifications → your browser), and Focus";

const OUTCOME: Readonly<Record<TestOutcome | 'sending', string>> = {
  sending: "Sent. Waiting for your browser's answer…",
  shown: `Your browser says it showed a test notification. If none appeared, check ${SYSTEM_SETTINGS}.`,
  accepted: `Your browser accepted a test notification. If none appeared, check ${SYSTEM_SETTINGS}.`,
  failed: `Your browser could not show a test notification. Check ${SYSTEM_SETTINGS}.`,
};

const NOTE: string = 'text-sm text-muted-foreground';
const ACTION: string = 'min-h-[44px] self-start';

export interface OsNotificationsControlProps {
  permission: OsPermission;
  /** Call from a click handler only. */
  ask: () => Promise<OsPermission>;
}

export function OsNotificationsControl({ permission, ask }: OsNotificationsControlProps): JSX.Element {
  const [outcome, setOutcome] = useState<TestOutcome | 'sending' | null>(null);
  const test = (): void => {
    setOutcome('sending');
    sendTestNotification().then(setOutcome, (): void => setOutcome('failed'));
  };
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="os-notifications-control" data-permission={permission}>
      {permission === 'unsupported' && <p className={NOTE}>This browser shows no system notifications, so they appear in the bell only.</p>}
      {permission === 'default' && (
        <>
          <p className={NOTE}>Notifications are not allowed on this device yet, so they appear in the bell only.</p>
          <Button type="button" className={ACTION} onClick={(): void => { void ask(); }}>Allow notifications</Button>
        </>
      )}
      {permission === 'denied' && (
        <p className={NOTE} role="alert">
          Your browser blocks notifications from this site, so they appear in the bell only. Allow them in this site&apos;s settings (the icon beside the address), then come back to this window.
        </p>
      )}
      {permission === 'granted' && (
        <>
          <p className={NOTE}>Notifications are allowed on this device.</p>
          <Button type="button" variant="outline" className={ACTION} onClick={test}>Send a test notification</Button>
          {outcome !== null && <p className={NOTE} role="status">{OUTCOME[outcome]}</p>}
        </>
      )}
    </div>
  );
}
