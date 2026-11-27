/**
 * The bell's word on system notifications, shown only once a notice meant for this device was held
 * this session because the browser does not allow them yet (os-permission.ts `heldForTheOs`), and
 * only until it does: the recoverable side of a delivery that would otherwise fail silently.
 */
import { useSyncExternalStore } from 'react';
import { heldForTheOs } from '@/lib/notification-service/os-permission';
import { OsNotificationsControl } from './OsNotificationsControl';
import { useOsPermission, type OsPermissionState } from './use-os-permission';

export function BellOsPrompt(): JSX.Element | null {
  const held: boolean = useSyncExternalStore(heldForTheOs.subscribe, heldForTheOs.get, heldForTheOs.get);
  const { permission, ask }: OsPermissionState = useOsPermission();
  if (!held || permission === 'granted') return null;
  return (
    <section aria-label="System notifications" className="mt-4 rounded-lg border border-border bg-surface px-3.5 py-3">
      <OsNotificationsControl permission={permission} ask={ask} />
    </section>
  );
}
