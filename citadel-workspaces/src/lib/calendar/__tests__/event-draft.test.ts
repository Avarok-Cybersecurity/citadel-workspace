/**
 * The event editor's checks over the real engine: wall times read in the zone the member makes
 * the event in, a spring-forward time resolved by the core, the end after the start, and the
 * store each kind of event is written to.
 */
import { describe, expect, it } from 'vitest';
import { bookingLink, bookingTargetOf } from '../booking-link';
import { checkEvent, type DraftContext, type EventDraft } from '../event-draft';
import { NY, realEngine, utc } from './engine-rig';
import type { EventCheck } from '@/lib/calendar/event-draft';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const engine: CalendarEngine = realEngine();
const ctx: DraftContext = { id: 'e9', node: 'n1', me: 'amy', zone: NY, nowMs: 5n };
const draft: EventDraft = {
  title: 'Planning', notes: '', date: { y: 2024, m: 7, d: 15 }, allDay: false, start: '09:00', end: '10:30',
  location: { kind: 'in_app' }, visibility: 'public', destination: 'authored', down: false, upTo: null, reminders: [],
};

describe('the event editor', () => {
  it('reads wall times in the zone it is made in and posts it under the member on the node', () => {
    const checked: EventCheck = checkEvent(draft, ctx, engine);
    if (!checked.ok) throw new Error([...checked.errors.values()].join('; '));
    expect(checked.event.when).toEqual({ once: { start_ms: utc('2024-07-15T13:00:00Z'), end_ms: utc('2024-07-15T14:30:00Z') } });
    expect(checked.event).toMatchObject({ id: 'e9', author: 'amy', origin_node: 'n1', zone: NY, hosts: ['amy'], created_ms: 5n, body: null });
    expect(checked.store).toEqual({ kind: 'authored', node: 'n1', author: 'amy' });
    expect(checked.key).toBe('cal/event/e9');
  });

  it("writes an official event to the node's store and a private one to the member's own", () => {
    const official: EventCheck = checkEvent({ ...draft, destination: 'node' }, ctx, engine);
    expect(official.ok && official.store).toEqual({ kind: 'node', node: 'n1' });
    const mine: EventCheck = checkEvent({ ...draft, visibility: 'private', destination: 'node' }, ctx, engine);
    expect(mine.ok && [mine.store, mine.key]).toEqual([{ kind: 'user' }, 'cal/private/e9']);
  });

  it('pushes only an official event down, pulls any shared one up, and never propagates a private one', () => {
    const propagate = (patch: Partial<EventDraft>): unknown => {
      const checked: EventCheck = checkEvent({ ...draft, down: true, upTo: 'root', ...patch }, ctx, engine);
      return checked.ok ? checked.event.propagate : null;
    };
    expect(propagate({ destination: 'node' })).toEqual({ down: true, up_to: 'root' });
    expect(propagate({ destination: 'authored' })).toEqual({ down: false, up_to: 'root' });
    expect(propagate({ destination: 'node', visibility: 'private' })).toEqual({ down: false, up_to: null });
  });

  it('places a time in the spring-forward gap as the core resolves it, never before the start', () => {
    const checked: EventCheck = checkEvent({ ...draft, date: { y: 2024, m: 3, d: 10 }, start: '02:30', end: '04:00' }, ctx, engine);
    if (!checked.ok) throw new Error('a gap time is resolved, not refused');
    const when: { once: { start_ms: bigint; end_ms: bigint; }; } = checked.event.when as { once: { start_ms: bigint; end_ms: bigint } };
    expect(when.once.start_ms).toBe(utc('2024-03-10T07:30:00Z'));
    expect(when.once.end_ms).toBe(utc('2024-03-10T08:00:00Z'));
  });

  it('refuses a blank title, an end at or before the start, and a place with no address', () => {
    const checked: EventCheck = checkEvent({ ...draft, title: ' ', end: '09:00', location: { kind: 'in_person', address: '' } }, ctx, engine);
    expect(checked.ok ? [] : [...checked.errors.keys()].sort()).toEqual(['end', 'location', 'title']);
  });

  it('keeps an all-day event as its date and ends a day at midnight', () => {
    const allDay: EventCheck = checkEvent({ ...draft, allDay: true, start: '', end: '' }, ctx, engine);
    expect(allDay.ok && allDay.event.when).toEqual({ all_day: { date: draft.date, days: 1 } });
    const late: EventCheck = checkEvent({ ...draft, start: '23:00', end: '24:00' }, ctx, engine);
    expect(late.ok && late.event.when).toEqual({ once: { start_ms: utc('2024-07-16T03:00:00Z'), end_ms: utc('2024-07-16T04:00:00Z') } });
  });
});

describe('the member deep link', () => {
  it("names the node's Calendar tab and the host, and reads back only on that node", () => {
    const link: string = bookingLink('https://w.example', { node: 'n1', host: 'ana', typeId: 't1' });
    expect(link).toBe('https://w.example/workspace?nodeId=n1&tab=app%3Anet.avarok.calendar&book=ana&type=t1');
    const search: string = new URL(link).search;
    expect(bookingTargetOf(search, 'n1')).toEqual({ node: 'n1', host: 'ana', typeId: 't1' });
    expect(bookingTargetOf(search, 'n2')).toBeNull();
    expect(bookingTargetOf('?nodeId=n1&tab=chat&book=ana', 'n1')).toBeNull();
    expect(bookingTargetOf(new URL(bookingLink('https://w.example', { node: 'n1', host: 'ana', typeId: null })).search, 'n1')).toEqual({ node: 'n1', host: 'ana', typeId: null });
  });
});
