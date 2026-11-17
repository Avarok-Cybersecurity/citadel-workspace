/**
 * What may be changed after saving, and the form read back from an event (event-edit.ts), over the
 * real engine: who is offered a change of which entry; the form read back and checked again is the
 * same event one revision on, including an all-day event and one ending at midnight; and an edit
 * may not move an event to another store.
 */
import { describe, expect, it } from 'vitest';
import { checkEvent } from '../event-draft';
import { cancelled, changeableBy, draftOf, revise, storedAt } from '../event-edit';
import type { Event } from '../generated/Event';
import type { EventEntry } from '../store';
import { event, NY, realEngine, utc } from './engine-rig';
import type { EventCheck } from '@/lib/calendar/event-draft';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const engine: CalendarEngine = realEngine();
const entry = (source: EventEntry['source'], e: Event): EventEntry => ({ key: `${source}/${e.id}`, source, event: e });
const amys: Event = event({ id: 'e1', author: 'amy', origin_node: 'n1' });

describe('who may change an event from here', () => {
  it("offers the node's own events to its editors, a posted event to its author and a private one to its owner", () => {
    expect([true, false].map((editor) => changeableBy(entry('node', amys), 'bob', editor))).toEqual([true, false]);
    expect(['amy', 'bob'].map((me) => changeableBy(entry('authored', amys), me, true))).toEqual([true, false]);
    expect(changeableBy(entry('private', amys), 'amy', false)).toBe(true);
    expect(changeableBy(entry('up_pulled', amys), 'amy', true)).toBe(false);
  });

  it('never offers a booking, a cancelled event or a recurring one', () => {
    const booking: Event = event({ author: 'amy', kind: { booking: { booking_id: 'b1' } } });
    const gone: Event = event({ author: 'amy', status: { cancelled: { by: 'amy', reason: null } } });
    const weekly: Event = event({ author: 'amy', when: { recurring: { rule: { freq: 'weekly', interval: 1, by_day: [], by_month_day: [], count: null }, start: { date: { y: 2024, m: 7, d: 15 }, minute: 540 }, duration_min: 30, exdates: [], until_ms: null } } });
    expect([booking, gone, weekly].map((e) => changeableBy(entry('node', e), 'amy', true))).toEqual([false, false, false]);
  });
});

describe('the form read back from an event', () => {
  const recheck = (e: Event, source: EventEntry['source']): Event => {
    const checked: EventCheck = checkEvent(draftOf(e, NY, engine, source), { id: e.id, node: e.origin_node, me: e.author, zone: NY, nowMs: 9n }, engine);
    if (!checked.ok) throw new Error([...checked.errors.values()].join('; '));
    return revise(e, storedAt(entry(source, e)), checked).event;
  };

  it('checks back into the same event, one revision on', () => {
    const shared: Event = event({ id: 'x', author: 'amy', body: 'agenda', location: { in_person: { address: '1 Main St' } }, visibility: 'busy_only', propagate: { down: true, up_to: 'root' } });
    expect(recheck(shared, 'node')).toEqual({ ...shared, rev: 2, updated_ms: 9n });
  });

  it('keeps an all-day event all day and an event ending at midnight ending then', () => {
    const allDay: Event = event({ author: 'amy', when: { all_day: { date: { y: 2024, m: 7, d: 15 }, days: 1 } } });
    expect(recheck(allDay, 'authored').when).toEqual(allDay.when);
    const late: Event = event({ author: 'amy', when: { once: { start_ms: utc('2024-07-16T02:00:00Z'), end_ms: utc('2024-07-16T04:00:00Z') } } });
    expect(draftOf(late, NY, engine, 'authored')).toMatchObject({ start: '22:00', end: '24:00' });
    expect(recheck(late, 'authored').when).toEqual(late.when);
  });

  it('may not move the event to another store', () => {
    const checked: EventCheck = checkEvent({ ...draftOf(amys, NY, engine, 'authored'), visibility: 'private' }, { id: 'e1', node: 'n1', me: 'amy', zone: NY, nowMs: 9n }, engine);
    if (!checked.ok) throw new Error('the form did not check');
    expect(() => revise(amys, storedAt(entry('authored', amys)), checked)).toThrow('another store');
  });

  it('cancels it as who cancelled, one revision on, where it is stored', () => {
    const at: ReturnType<typeof storedAt> = storedAt(entry('authored', amys));
    expect(at).toEqual({ store: { kind: 'authored', node: 'n1', author: 'amy' }, key: 'cal/event/e1' });
    expect(cancelled(amys, at, 'amy', null, 9n).event).toEqual({ ...amys, rev: 2, updated_ms: 9n, status: { cancelled: { by: 'amy', reason: null } } });
  });
});
