/**
 * The Calendar's tab as the first-party registry mounts it (first-party/registry.ts): the core
 * loaded for the page, its ports over the glue instance the tab was bound with, the member's
 * display zone (asked once, ZoneQuestion), and the store kept read from storage and refreshed on
 * StorageChanged (use-calendar-sources.ts), in CalendarPane. Its notices are under the member's
 * notification settings (notice-gate.ts); its reminders are the background's (background/). An
 * .ics file the member opened in the Calendar is reviewed over the pane (OpenedIcs.tsx).
 */
import { useEffect, useMemo, useState } from 'react';
import type { GlueTabProps } from '@/lib/citadel-apps/first-party/registry';
import { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import { intlOffsetAt } from '@/lib/calendar/engine/intl-offsets';
import { loadCalendarWasm } from '@/lib/calendar/engine/load-calendar-wasm';
import { calendarPorts, type CalendarPorts } from '@/lib/calendar/ports';
import { withNoticePrefs } from '@/lib/calendar/notice-gate';
import { CALENDAR_APP_ID } from '@/lib/calendar/app-id';
import { recordAppNoticeDelivery } from '@/lib/citadel-apps/app-notice-delivery';
import { displayZoneOf, type DisplayZoneChoice } from '@/lib/calendar/zones';
import { CalendarPane } from './CalendarPane';
import { useCalendarSettings, type SettingsState } from './use-calendar-settings';
import { ZoneQuestion } from './ZoneQuestion';
import { OpenedIcs } from './OpenedIcs';
import { useOpenedFile, type OpenedFileState } from './use-opened-file';
import { pageOpenedFiles } from '@/lib/citadel-apps/runtime/page-opened-files';
import { UnreadablePanel } from './UnreadablePanel';
import { RecoveryNotice } from '@/components/recovery-route/RecoveryNotice';
import { recovery } from '@/lib/recovery-route/recovery';

type EngineState = { kind: 'loading' } | { kind: 'ready'; engine: CalendarEngine } | { kind: 'failed' };

function Status({ children }: { children: React.ReactNode }): JSX.Element {
  return <p role="status" className="m-[16px] text-sm text-muted-foreground">{children}</p>;
}

export function CalendarMount({ glue, install, manifest, nodeId, me, mayEditNode }: GlueTabProps): JSX.Element {
  const ports: CalendarPorts = useMemo(() => withNoticePrefs(calendarPorts(glue), (system: boolean): void => recordAppNoticeDelivery(CALENDAR_APP_ID, system)), [glue]);
  const [loaded, setLoaded] = useState<EngineState>({ kind: 'loading' });
  useEffect(() => {
    let live: boolean = true;
    loadCalendarWasm().then((g) => { if (live) setLoaded({ kind: 'ready', engine: new CalendarEngine(g, intlOffsetAt()) }); }, (error: unknown): void => {
      console.error('[calendar] the core did not load', error);
      if (live) setLoaded({ kind: 'failed' });
    });
    return (): void => { live = false; };
  }, []);
  const settings: SettingsState = useCalendarSettings(ports);
  const opened: OpenedFileState = useOpenedFile(pageOpenedFiles, install.app_id, manifest);
  const deviceZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (loaded.kind === 'failed') return <RecoveryNotice className="m-[16px]" recovery={recovery('calendar.engine-failed', {})} message="The Calendar could not be loaded." />;
  if (settings.kind === 'failed') return <div className="m-[16px]"><UnreadablePanel what="Your Calendar settings" reason={settings.reason} retry={settings.retry} /></div>;
  if (loaded.kind === 'loading' || settings.kind === 'loading') return <Status>Loading the Calendar…</Status>;
  if (settings.kind === 'absent') {
    return <ZoneQuestion deviceZone={deviceZone} saving={settings.saving} error={settings.error} onChoose={(choice: DisplayZoneChoice): void => settings.choose(choice)} />;
  }
  const displayZone: string = displayZoneOf(settings.settings.displayZone, deviceZone);
  return (
    <>
      <CalendarPane ports={ports} engine={loaded.engine} nodeId={nodeId} me={me} displayZone={displayZone} deviceZone={deviceZone} held={glue.held} mayEditNode={mayEditNode} />
      {opened.file !== null && <OpenedIcs file={opened.file} ports={ports} engine={loaded.engine} displayZone={displayZone} nodeId={nodeId} me={me} onDone={opened.done} />}
    </>
  );
}
