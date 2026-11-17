/**
 * The Calendar tab as mounted, over the real core, ports and gate: New (and "n" on a day) opens
 * the event editor and saving posts the event under the member on the node; a member's booking
 * page saves their types and hours where a booker reads them; and a member deep link opens the
 * host's booking page, where booking an offline host leaves a request in the booker's own
 * namespace for the host to confirm.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTRO, WORKING_HOURS } from '@/lib/calendar/__tests__/booking-fixture';
import { realEngine } from '@/lib/calendar/__tests__/engine-rig';
import { MemoryStore } from '@/lib/calendar/__tests__/memory-store';
import { bookingLink } from '@/lib/calendar/booking-link';
import { formatDayLong } from '@/lib/calendar/format';
import type { KvBackend } from '@/lib/citadel-apps/sdk/generated/KvBackend';
import { encodeSettings, SETTINGS_KEY } from '@/lib/calendar/zones';
import { mountCalendar, mountRig } from './mount-rig';
import type { Booking } from '@/lib/calendar/generated/Booking';
import type { Availability } from '@/lib/calendar/generated/Availability';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import type * as CalendarGlue from '../../../../vendor/calendar/calendar_glue.js';
import type { Event } from '@/lib/calendar/generated/Event';

vi.mock('@/lib/calendar/engine/load-calendar-wasm', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const glue: typeof CalendarGlue = await import('../../../../vendor/calendar/calendar_glue.js');
  return {
    loadCalendarWasm: async (): Promise<typeof CalendarGlue> => {
      glue.initSync({ module: readFileSync(join(process.cwd(), 'public/calendar/calendar_glue_bg.wasm')) });
      return glue;
    },
  };
});

const engine: CalendarEngine = realEngine();
const authored = (author: string): KvBackend => ({ node_authored: { node_id: 'n1', author } });

function signedIn(me: string, store: MemoryStore = new MemoryStore(me)): MemoryStore {
  store.put('user', SETTINGS_KEY, encodeSettings({ displayZone: { kind: 'fixed', zone: 'America/New_York' } }));
  mountCalendar(mountRig(me, store).glue, me, false);
  return store;
}

const decoded = <T,>(store: MemoryStore, prefix: string, as: (b: Uint8Array) => T): T[] =>
  [...store.values.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => as(v));

beforeEach((): void => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2024-07-16T15:00:00Z'));
  window.history.replaceState(null, '', '/workspace?nodeId=n1');
});
afterEach((): void => { vi.useRealTimers(); });

describe('the Calendar tab', () => {
  it('opens the event editor from New, and posts the saved event under the member on the node', async () => {
    const store: MemoryStore = signedIn('amy');
    fireEvent.click(await screen.findByRole('button', { name: 'New' }));
    // The editor opens once the member's notification settings are read: a new event starts with their reminders.
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Planning' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save event' })); });
    await waitFor(() => expect(screen.queryByTestId('calendar-event-editor')).toBeNull());
    const events: Event[] = decoded(store, 'authored:n1:amy|cal/event/', (b) => engine.decodeEvent(b));
    expect(events.map((e) => [e.title, e.author, e.zone])).toEqual([['Planning', 'amy', 'America/New_York']]);
  });

  it('opens the event editor on the focused day when "n" is pressed in the grid', async () => {
    signedIn('amy');
    const grid: HTMLElement = await screen.findByTestId('calendar-month-grid');
    const focused: HTMLElement | undefined = within(grid).getAllByRole('gridcell').find((c) => c.tabIndex === 0);
    if (focused === undefined) throw new Error('the grid has no tab stop');
    fireEvent.keyDown(focused, { key: 'n' });
    expect(within(await screen.findByTestId('calendar-event-editor')).getByLabelText('Day')).toHaveValue('2024-07-16');
  });

  it("saves a member's types and hours on their booking page, where a booker reads them", async () => {
    const store: MemoryStore = signedIn('amy');
    fireEvent.click(await screen.findByRole('button', { name: 'Your booking page' }));
    fireEvent.click(await screen.findByRole('button', { name: 'New event type' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Intro call' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save event type' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save hours' })); });
    await screen.findByText('Saved. Bookings use these hours from now on.');
    expect(decoded(store, 'authored:n1:amy|cal/type/', (b) => engine.decodeEventType(b)).map((t) => [t.name, t.durations_min])).toEqual([['Intro call', [30]]]);
    const hours: Availability[] = decoded(store, 'authored:n1:amy|cal/availability', (b) => engine.decodeAvailability(b));
    expect(hours.map((h) => [h.zone, h.weekly[0], h.weekly[5]])).toEqual([['America/New_York', [{ start_min: 540, end_min: 1020 }], []]]);
    expect(screen.getByLabelText(/Link to book you/)).toHaveValue(bookingLink(window.location.origin, { node: 'n1', host: 'amy', typeId: null }));
  });

  it("opens the host's page from a member deep link, and leaves a request for an offline host", async () => {
    const store: MemoryStore = new MemoryStore('bob');
    store.values.set(store.where(authored('ana'), 'cal/type/t1', false), engine.encodeEventType(INTRO));
    store.values.set(store.where(authored('ana'), 'cal/availability', false), engine.encodeAvailability(WORKING_HOURS));
    const link: URL = new URL(bookingLink(window.location.origin, { node: 'n1', host: 'ana', typeId: 't1' }));
    window.history.replaceState(null, '', link.pathname + link.search);
    signedIn('bob', store);
    await screen.findByRole('heading', { name: 'Book with ana' });
    const day: RegExp = new RegExp(`^${formatDayLong({ y: 2024, m: 7, d: 17 })},`);
    fireEvent.click(within(screen.getByRole('group', { name: 'Days with free times' })).getByRole('button', { name: day }));
    fireEvent.click(screen.getAllByTestId('calendar-slot')[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText(/What should we cover\?/), { target: { value: 'Roadmap' } });
    await act(async () => { fireEvent.click(screen.getByTestId('calendar-confirm-booking')); });
    await waitFor(() => expect(screen.getByTestId('calendar-booking-said')).toHaveTextContent(/^Requested: ana is not online/));
    const requests: Booking[] = decoded(store, 'authored:n1:bob|cal/booking/', (b) => engine.decodeBooking(b));
    expect(requests.map((r) => [r.host, r.booker, r.type_id, r.state, r.answers])).toEqual([['ana', { member: { username: 'bob' } }, 't1', 'requested', [{ question_id: 'q-topic', value: 'Roadmap' }]]]);
    expect(new Date(Number(requests[0]?.start_ms)).toISOString()).toBe('2024-07-17T13:00:00.000Z');
  });
});
