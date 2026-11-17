/**
 * The apps the member has answered (design §3.8): each with whether it may change their calendar,
 * and a way to take the answer back, after which the app is asked again the next time it tries.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import { PortRefused, refusalCopy, type CalendarPorts } from '@/lib/calendar/ports';
import { forgetConsent, readConsents, type AppConsent } from '@/lib/calendar/sdk-store';

type Loaded = { kind: 'loading' } | { kind: 'failed'; reason: string } | { kind: 'ready'; apps: AppConsent[] };

const reasonOf = (e: unknown): string => (e instanceof PortRefused ? refusalCopy(e.refused) : 'something went wrong');

export function SdkAppsPanel({ ports, engine }: { ports: CalendarPorts; engine: CalendarEngine }): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [said, setSaid] = useState<string>('');
  const reload: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      setLoaded({ kind: 'ready', apps: await readConsents(ports, engine) });
    } catch (e: unknown) {
      setLoaded({ kind: 'failed', reason: reasonOf(e) });
    }
  }, [ports, engine]);
  useEffect(() => { void reload(); }, [reload]);
  const forget = async (appId: string): Promise<void> => {
    try {
      await forgetConsent(ports, appId);
      await reload();
      setSaid(`${appId} will be asked again.`);
    } catch (e: unknown) {
      setSaid(`Your answer for ${appId} was not changed: ${reasonOf(e)}.`);
    }
  };

  if (loaded.kind === 'loading') return <p role="status" className="text-sm text-muted-foreground">Loading the apps using your calendar…</p>;
  if (loaded.kind === 'failed') return <p role="alert" className="text-sm text-destructive-emphasis">The apps using your calendar could not be read: {loaded.reason}.</p>;
  return (
    <section aria-label="Apps using your calendar" className="flex min-w-0 flex-col gap-2" data-testid="calendar-sdk-apps">
      <h3 className="text-sm font-semibold text-foreground">Apps using your calendar</h3>
      {loaded.apps.length === 0 && <p className="text-sm text-muted-foreground">None yet. An app asks before it first changes your calendar.</p>}
      <ul className="flex min-w-0 flex-col gap-1">
        {loaded.apps.map((a: AppConsent) => (
          <li key={a.appId} className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-border px-3">
            <span className="min-w-0 flex-1 truncate py-2 text-sm text-foreground">{a.appId} · {a.consent === 'allow' ? 'may change your calendar' : 'refused'}</span>
            <Button type="button" variant="ghost" className="h-[44px] shrink-0" aria-label={`Ask ${a.appId} again`} onClick={(): void => { void forget(a.appId); }}>Ask again</Button>
          </li>
        ))}
      </ul>
      <p aria-live="polite" role="status" className="text-sm text-foreground">{said}</p>
    </section>
  );
}
