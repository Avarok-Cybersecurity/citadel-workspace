/**
 * The Calendar opens on today's date and shows an event the member just imported for it. On a
 * page the instance's dispatch clock is performance.now(), the time since the page loaded; read as
 * a date it put the tab on January 1970, so an import succeeded and its event was never on screen.
 *
 * The real core, ports, gate, tab and committed manifest, as an-opened-ics-is-reviewed-then-
 * imported.test.tsx mounts them; the clocks are held far apart (a page five seconds old, a wall
 * clock in November 2026) so that reading the wrong one cannot pass. jsdom cannot fetch the core's
 * binary, so the loader hands back the vendored glue initialised from the committed file.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Toaster } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppInstall, AppManifest } from 'citadel-workspace-client-ts';
import { ManualClock } from '@/lib/citadel-apps/host/__tests__/fakes';
import { readManifestBytes, type ManifestReading } from '@/lib/citadel-apps/manifest/manifest-rules';
import { pageOpenedFiles } from '@/lib/citadel-apps/runtime/page-opened-files';
import { CALENDAR_APP_ID } from '@/lib/calendar/app-id';
import { encodeSettings, SETTINGS_KEY } from '@/lib/calendar/zones';
import { mountCalendarAs, mountRig, type MountRig } from './mount-rig';
import type * as CalendarGlue from '../../../../vendor/calendar/calendar_glue.js';

vi.mock('@/lib/calendar/engine/load-calendar-wasm', async () => {
  const { readFileSync: read } = await import('node:fs');
  const { join: joined } = await import('node:path');
  const glue: typeof CalendarGlue = await import('../../../../vendor/calendar/calendar_glue.js');
  return {
    loadCalendarWasm: async (): Promise<typeof CalendarGlue> => {
      glue.initSync({ module: read(joined(process.cwd(), 'public/calendar/calendar_glue_bg.wasm')) });
      return glue;
    },
  };
});

const reading: ManifestReading = readManifestBytes(readFileSync(join(process.cwd(), '..', 'apps/first-party/calendar/manifest.json')));
if (!reading.ok) throw new Error(`the committed Calendar manifest does not read: ${reading.why}`);
const MANIFEST: AppManifest = reading.manifest;
// The tab reads only the install's app id; the rest of an install is the kernel's.
const INSTALL: AppInstall = { app_id: CALENDAR_APP_ID } as AppInstall;

const SINCE_LOAD: number = 5_000;
const WALL: number = Date.parse('2026-11-25T15:00:00Z');
const ICS: string = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN',
  'BEGIN:VEVENT', 'UID:k@x', 'DTSTART:20261125T170000Z', 'DTEND:20261125T180000Z', 'SUMMARY:Kickoff', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n');

function mounted(): MountRig {
  const rig: MountRig = mountRig('amy', undefined, null, { dispatch: new ManualClock(SINCE_LOAD), wallNow: (): number => WALL });
  rig.store.put('user', SETTINGS_KEY, encodeSettings({ displayZone: { kind: 'fixed', zone: 'UTC' } }));
  render(<Toaster />);
  mountCalendarAs(rig.glue, 'amy', false, INSTALL, MANIFEST);
  return rig;
}

afterEach((): void => {
  // Takes and drops any file a test left waiting, so the page's inbox is empty for the next.
  pageOpenedFiles.take(CALENDAR_APP_ID, (): void => undefined)();
});

describe('the Calendar on a page that has been open for five seconds', () => {
  it("opens on today's month, by the wall clock", async () => {
    mounted();
    expect((await screen.findByTestId('calendar-heading')).textContent).toBe('November 2026');
  });

  it('shows the event the member just imported for today', async () => {
    mounted();
    const tab: HTMLElement = await screen.findByTestId('calendar-tab');
    act(() => pageOpenedFiles.offer(CALENDAR_APP_ID, { name: 'kickoff.ics', mime: 'text/calendar', bytes: new TextEncoder().encode(ICS) }));
    fireEvent.click(await screen.findByTestId('ics-import-confirm'));
    await waitFor(() => expect(screen.queryByTestId('ics-import-review')).toBeNull());
    await waitFor(() => expect(within(tab).getAllByTestId('calendar-event-chip').map((c: HTMLElement) => c.textContent)).toEqual([expect.stringContaining('Kickoff')]));
  });
});
