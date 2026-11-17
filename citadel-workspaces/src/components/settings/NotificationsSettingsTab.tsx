/**
 * Notifications, by where they come from. The workspace's own (messages, requests) follow the
 * Privacy tab's preview setting; each app that raises notifications is listed with its own,
 * loaded only when this tab is opened, so no app's code is on the Settings' critical path.
 */
import { useEffect, useState, type ComponentType } from 'react';
import { CalendarDays } from 'lucide-react';

function useLoaded(load: () => Promise<{ default: ComponentType }>): ComponentType | 'loading' | 'failed' {
  const [loaded, setLoaded] = useState<ComponentType | 'loading' | 'failed'>('loading');
  useEffect(() => {
    let live: boolean = true;
    load().then((m: { default: ComponentType }): void => { if (live) setLoaded(() => m.default); }, (error: unknown): void => {
      console.error('[settings] an app\'s notification settings did not load', error);
      if (live) setLoaded('failed');
    });
    return (): void => { live = false; };
  }, [load]);
  return loaded;
}

const loadCalendar = (): Promise<{ default: ComponentType }> => import('@/components/calendar/background/CalendarNotificationsHere');

export function NotificationsSettingsTab(): JSX.Element {
  const Calendar: ComponentType | 'loading' | 'failed' = useLoaded(loadCalendar);
  return (
    <div className="space-y-5" data-testid="settings-notifications">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">App notifications</h3>
        <p className="text-sm text-muted-foreground">What each app may tell you, for your account. An app raises notifications only if your admin allowed it to when it was installed.</p>
      </div>
      <section aria-labelledby="settings-notify-calendar" className="space-y-3 rounded-lg border border-border bg-card/40 p-3 sm:p-4">
        <h4 id="settings-notify-calendar" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarDays className="h-4 w-4 text-primary-accent" aria-hidden="true" />
          Calendar
        </h4>
        {Calendar === 'loading' && <p role="status" className="text-sm text-muted-foreground">Loading…</p>}
        {Calendar === 'failed' && <p role="alert" className="text-sm text-destructive-emphasis">The Calendar's settings could not be loaded. Reload the page to try again.</p>}
        {typeof Calendar === 'function' && <Calendar />}
      </section>
    </div>
  );
}
