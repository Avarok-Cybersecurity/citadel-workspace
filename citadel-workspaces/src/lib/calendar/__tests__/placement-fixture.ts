/** Entries of every kind a node calendar shows, for the placement and view tests. */
import type { Event } from '../generated/Event';
import type { Projection } from '../generated/Projection';
import { entryKey, type CalendarEntry } from '../store';
import { event, NY, utc } from './event-fixture';

export const VIEWER: string = 'alice';

const own = (storageKey: string, e: Event): CalendarEntry => ({ key: entryKey('node', 'n1', null, storageKey), source: 'node', event: e });

export const standup: CalendarEntry = own('cal/event/standup', event({ id: 'standup', title: 'Standup' }));

export const lateRelease: CalendarEntry = own('cal/event/release', event({
  id: 'release', title: 'Release night',
  when: { once: { start_ms: utc('2024-07-16T03:00:00Z'), end_ms: utc('2024-07-16T06:00:00Z') } },
}));

export const cancelled: CalendarEntry = own('cal/event/retro', event({
  id: 'retro', title: 'Retro', status: { cancelled: { by: 'alice', reason: 'Holiday' } },
  when: { once: { start_ms: utc('2024-07-17T18:00:00Z'), end_ms: utc('2024-07-17T19:00:00Z') } },
}));

export const bobsBusy: CalendarEntry = {
  key: entryKey('authored', 'n1', 'bob', 'cal/event/dentist'), source: 'authored',
  event: event({ id: 'dentist', author: 'bob', title: 'Dentist', visibility: 'busy_only', when: { once: { start_ms: utc('2024-07-18T14:00:00Z'), end_ms: utc('2024-07-18T15:00:00Z') } } }),
};

export const offsite: CalendarEntry = own('cal/event/offsite', event({ id: 'offsite', title: 'Offsite', when: { all_day: { date: { y: 2024, m: 7, d: 18 }, days: 2 } } }));

const allHands: Projection = {
  title: 'All-hands', when: { once: { start_ms: utc('2024-07-15T14:00:00Z'), end_ms: utc('2024-07-15T15:00:00Z') } },
  zone: NY, location: 'in_app', hosts: ['carol'], origin_node: 'company', origin_rev: 3,
};
export const inherited: CalendarEntry = { key: entryKey('inherited', 'n1', null, 'cal/inherit/company/allhands'), source: 'inherited', projection: allHands, linked: false };

export const upPulled: CalendarEntry = {
  key: entryKey('up_pulled', 'team-d', 'dave', 'cal/event/review'), source: 'up_pulled',
  event: event({ id: 'review', author: 'dave', origin_node: 'team-d', title: 'Design review', propagate: { down: false, up_to: 'n1' }, when: { once: { start_ms: utc('2024-07-15T13:15:00Z'), end_ms: utc('2024-07-15T14:15:00Z') } } }),
};

export const weekly: CalendarEntry = own('cal/event/weekly', event({
  id: 'weekly', title: 'Planning',
  when: { recurring: { start: { date: { y: 2026, m: 3, d: 2 }, minute: 9 * 60 }, duration_min: 30, rule: { freq: 'weekly', interval: 1, by_day: ['mon'], by_month_day: [], count: null }, exdates: [], until_ms: null } },
}));

export const nowhere: CalendarEntry = own('cal/event/mars', event({
  id: 'mars', title: 'Mars sync', zone: 'Mars/Olympus_Mons',
  when: { recurring: { start: { date: { y: 2024, m: 7, d: 15 }, minute: 600 }, duration_min: 30, rule: { freq: 'daily', interval: 1, by_day: [], by_month_day: [], count: null }, exdates: [], until_ms: null } },
}));

export const JULY_WEEK: CalendarEntry[] = [standup, lateRelease, cancelled, bobsBusy, offsite, inherited, upPulled];
