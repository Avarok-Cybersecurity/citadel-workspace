/**
 * An .ics file a member opened in the Calendar, through the page's opened-files inbox, as the file
 * browser and chat hand it over: the tab reviews it (title, each event's time, how many, what is not
 * imported) and writes nothing until Import, which saves each event as the member's own private
 * event; Cancel and Escape write nothing. What the committed manifest does not declare (another
 * extension, a file over its max_bytes) is not taken, and the member is told.
 *
 * The real core, ports, gate and committed manifest. One module is replaced: jsdom cannot fetch the
 * core's binary from its URL, so the loader hands back the vendored glue initialised from the
 * committed file, as the other mount tests do.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Toaster } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppInstall, AppManifest } from 'citadel-workspace-client-ts';
import { readManifestBytes, type ManifestReading } from '@/lib/citadel-apps/manifest/manifest-rules';
import { pageOpenedFiles } from '@/lib/citadel-apps/runtime/page-opened-files';
import { CALENDAR_APP_ID } from '@/lib/calendar/app-id';
import { encodeSettings, SETTINGS_KEY } from '@/lib/calendar/zones';
import { PRIVATE_PREFIX } from '@/lib/calendar/read-sources';
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

const ICS: string = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN',
  'BEGIN:VEVENT', 'UID:a@x', 'DTSTART:20240718T140000Z', 'DTEND:20240718T150000Z', 'SUMMARY:Boiler service', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:b@x', 'DTSTART;VALUE=DATE:20240719', 'SUMMARY:Site visit', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:c@x', 'DTSTART:20240720T140000Z', 'DTEND:20240720T150000Z', 'SUMMARY:Dropped', 'STATUS:CANCELLED', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n');
const file = (name: string, text: string = ICS): { name: string; mime: string; bytes: Uint8Array } => ({ name, mime: 'text/calendar', bytes: new TextEncoder().encode(text) });

function mounted(): MountRig {
  const rig: MountRig = mountRig('amy');
  rig.store.put('user', SETTINGS_KEY, encodeSettings({ displayZone: { kind: 'fixed', zone: 'America/New_York' } }));
  render(<Toaster />);
  mountCalendarAs(rig.glue, 'amy', false, INSTALL, MANIFEST);
  return rig;
}
const privateKeys = (rig: MountRig): string[] => [...rig.store.values.keys()].filter((k: string): boolean => k.startsWith(`user:amy|${PRIVATE_PREFIX}`));

beforeEach((): void => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2024-07-16T15:00:00Z')); });
afterEach((): void => {
  vi.useRealTimers();
  // Takes and drops any file a test left waiting, so the page's inbox is empty for the next.
  pageOpenedFiles.take(CALENDAR_APP_ID, (): void => undefined)();
});

describe('an .ics file opened in the Calendar', () => {
  it('is reviewed with its title, each event and its count, and Cancel writes nothing', async () => {
    const rig: MountRig = mounted();
    await screen.findByTestId('calendar-tab');
    act(() => pageOpenedFiles.offer(CALENDAR_APP_ID, file('team.ics')));
    const review: HTMLElement = await screen.findByTestId('ics-import-review');
    expect(screen.getByRole('heading', { name: 'Import team.ics' })).toBeTruthy();
    expect(screen.getByTestId('ics-import-count').textContent).toBe('2 events to add to your own calendar.');
    expect(review.textContent).toContain('Not imported: 1 cancelled event.');
    expect(review.textContent).toContain('Times without a zone of their own are read in America/New_York.');
    expect(screen.getAllByTestId('ics-import-event').map((e: HTMLElement) => e.firstElementChild?.textContent)).toEqual(['Boiler service', 'Site visit']);
    expect(screen.getAllByTestId('ics-import-event')[1]?.textContent).toContain('all day');
    const buttons: HTMLButtonElement[] = [...review.querySelectorAll('button')].filter((b: HTMLButtonElement) => b.textContent === 'Cancel' || b.textContent === 'Import 2 events');
    expect(buttons.map((b: HTMLButtonElement) => [b.textContent, b.className.includes('h-[44px]')])).toEqual([['Cancel', true], ['Import 2 events', true]]);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('ics-import-review')).toBeNull());
    expect(privateKeys(rig)).toEqual([]);
  });

  it('writes nothing when dismissed with Escape either', async () => {
    const rig: MountRig = mounted();
    await screen.findByTestId('calendar-tab');
    act(() => pageOpenedFiles.offer(CALENDAR_APP_ID, file('team.ics')));
    fireEvent.keyDown(await screen.findByTestId('ics-import-review'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('ics-import-review')).toBeNull());
    expect(privateKeys(rig)).toEqual([]);
  });

  it('saves each event as the member\'s own private event on Import, and shows them', async () => {
    const rig: MountRig = mounted();
    await screen.findByTestId('calendar-tab');
    act(() => pageOpenedFiles.offer(CALENDAR_APP_ID, file('team.ics')));
    fireEvent.click(await screen.findByRole('button', { name: 'Import 2 events' }));
    await waitFor(() => expect(screen.queryByTestId('ics-import-review')).toBeNull());
    expect(privateKeys(rig)).toHaveLength(2);
    await screen.findByText('2 events from team.ics added to your calendar');
  });

  it('waits for the tab when offered before it mounted', async () => {
    pageOpenedFiles.offer(CALENDAR_APP_ID, file('early.ics'));
    mounted();
    expect((await screen.findByRole('heading', { name: 'Import early.ics' })).textContent).toBe('Import early.ics');
  });

  it('says why a file that is not a calendar cannot be imported, and offers no Import', async () => {
    mounted();
    await screen.findByTestId('calendar-tab');
    act(() => pageOpenedFiles.offer(CALENDAR_APP_ID, file('broken.ics', 'hello')));
    const review: HTMLElement = await screen.findByTestId('ics-import-review');
    expect(review.textContent).toContain('broken.ics cannot be imported: it is not a calendar file.');
    expect(screen.queryByTestId('ics-import-confirm')).toBeNull();
  });

  it('is not taken past what the manifest declares, and the member is told (control: the .ics above is)', async () => {
    mounted();
    await screen.findByTestId('calendar-tab');
    act(() => pageOpenedFiles.offer(CALENDAR_APP_ID, file('notes.md')));
    await screen.findByText('Calendar did not open notes.md: the app does not open .md files.');
    act(() => pageOpenedFiles.offer(CALENDAR_APP_ID, { ...file('huge.ics'), bytes: new Uint8Array(Number(MANIFEST.opens?.max_bytes ?? 0n) + 1) }));
    await screen.findByText(/^Calendar did not open huge\.ics: the file is larger than the 1048576 bytes/);
    expect(screen.queryByTestId('ics-import-review')).toBeNull();
  });
});
