/**
 * The Calendar's background work (calendar-background.ts) tells a member what concerns them with
 * no Calendar tab open: a reminder when it falls due, those that fell due while no window was open
 * once and never as if on time, an invitation someone else made, a booking its host cancelled, and
 * a new poll on a page they see. Each through the member's settings, and each once, however often
 * the change is heard. The rig's store, clock, change feed and notify port are the stand-ins.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startCalendarBackground } from '../calendar-background';
import type { Event } from '../generated/Event';
import type { Poll } from '../generated/Poll';
import { encodePrefs, NOTIFY_PREFS_KEY, PREFS_BEFORE_CHOICE } from '../notify-prefs';
import { POLL_PREFIX } from '../polls';
import { encodeHandled, HANDLED_KEY } from '../reminder-runner';
import { planOf, REMINDER_PREFIX } from '../reminder-scheduler';
import { realEngine } from './engine-rig';
import { event, NY, utc } from './event-fixture';
import { noticeMember, settle, type NoticeMember } from './notice-rig';
import type { ReminderPlan } from '@/lib/calendar/generated/ReminderPlan';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const engine: CalendarEngine = realEngine();
const USER = { kind: 'user' } as const;
const NOW: string = '2024-07-16T13:00:00Z';
const stops: (() => void)[] = [];
afterEach(() => { stops.splice(0).forEach((stop) => stop()); });

function start(m: NoticeMember, me: string): void {
  stops.push(startCalendarBackground({ ports: m.ports, engine, me, nodeName: (id: string) => (id === 'n1' ? 'Engineering' : id), deviceZone: NY, report: (what: string, e: unknown): void => { throw new Error(`${what}: ${String(e)}`); } }));
}

async function withPlan(m: NoticeMember, ev: Event, handledIso: string): Promise<void> {
  const plan: ReminderPlan | null = planOf(ev, utc('2024-07-16T00:00:00Z'), engine);
  if (plan === null) throw new Error('no plan');
  await m.ports.storage.set({ kind: 'node', node: 'n1' }, `cal/event/${ev.id}`, engine.encodeEvent(ev));
  await m.ports.storage.set(USER, `${REMINDER_PREFIX}${ev.id}`, engine.encodeReminderPlan(plan));
  await m.ports.storage.set(USER, HANDLED_KEY, encodeHandled(utc(handledIso)));
}

const standup: Event = event({ id: 'm1', author: 'ana', title: 'Standup', reminders: [{ minutes_before: 10 }], when: { once: { start_ms: utc('2024-07-16T13:15:00Z'), end_ms: utc('2024-07-16T13:30:00Z') } } });
const poll = (host: string): Poll => ({ id: 'p1', type_id: 't1', host, title: 'Retro', zone: NY, proposals: [{ start_ms: utc('2024-07-20T15:00:00Z'), end_ms: utc('2024-07-20T16:00:00Z') }], state: 'open' });

describe('the Calendar with no tab open', () => {
  it('reminds the member when a reminder falls due', async () => {
    const ana: NoticeMember = noticeMember('ana', new Map(), Date.parse(NOW));
    await withPlan(ana, standup, NOW);
    start(ana, 'ana');
    await settle();
    expect(ana.notes).toEqual([]);
    for (let minute: number = 0; minute < 5; minute += 1) {
      ana.clock.advance(60_000);
      await settle();
    }
    expect(ana.notes).toEqual(['Standup: Starts at 9:15 AM · Engineering']);
  });

  it('lists what fell due while no window was open once, and never fires it as if on time', async () => {
    const ana: NoticeMember = noticeMember('ana', new Map(), Date.parse('2024-07-16T15:00:00Z'));
    await withPlan(ana, standup, '2024-07-16T12:00:00Z');
    start(ana, 'ana');
    await settle();
    expect(ana.notes).toEqual(['A reminder you missed: Standup (Tue, Jul 16, 9:15 AM)']);
    ana.clock.advance(120_000);
    await settle();
    expect(ana.notes).toHaveLength(1);
  });

  it('reminds nobody of what the member turned off', async () => {
    const ana: NoticeMember = noticeMember('ana', new Map(), Date.parse(NOW));
    await ana.ports.storage.set(USER, NOTIFY_PREFS_KEY, encodePrefs({ ...PREFS_BEFORE_CHOICE, kinds: { ...PREFS_BEFORE_CHOICE.kinds, reminders: false } }));
    await withPlan(ana, standup, NOW);
    start(ana, 'ana');
    for (let minute: number = 0; minute < 5; minute += 1) {
      ana.clock.advance(60_000);
      await settle();
    }
    expect(ana.notes).toEqual([]);
  });

  it("tells of someone else's new poll once, however often it is heard, and never of the member's own", async () => {
    const shared: Map<string, Uint8Array> = new Map();
    const ana: NoticeMember = noticeMember('ana', shared, Date.parse(NOW));
    const bo: NoticeMember = noticeMember('bo', shared, Date.parse(NOW));
    await bo.ports.storage.set({ kind: 'authored', node: 'n1', author: 'bo' }, `${POLL_PREFIX}p1`, engine.team.encodePoll(poll('bo')));
    start(ana, 'ana');
    start(bo, 'bo');
    const change = { backend: { node_authored: { node_id: 'n1', author: 'bo' } }, key: `${POLL_PREFIX}p1` } as const;
    ana.hear(change);
    ana.hear(change);
    bo.hear(change);
    await settle();
    expect(ana.notes).toEqual(['New poll: Retro: bo asks when everyone can meet · Engineering']);
    expect(bo.notes).toEqual([]);
  });

  it('tells of an invitation and of a booking its host cancelled; not of one the booker cancelled, one for someone else, or the member\'s own', async () => {
    const shared: Map<string, Uint8Array> = new Map();
    const ana: NoticeMember = noticeMember('ana', shared, Date.parse(NOW));
    const bo: NoticeMember = noticeMember('bo', shared, Date.parse(NOW));
    const authored = { kind: 'authored', node: 'n1', author: 'bo' } as const;
    const invite: Event = event({ id: 'i1', author: 'bo', title: 'Retro', invitees: [{ member: { username: 'ana' } }], when: { once: { start_ms: utc('2024-07-20T15:00:00Z'), end_ms: utc('2024-07-20T16:00:00Z') } } });
    const booked: Event = event({ id: 'b1', author: 'bo', title: 'Intro', kind: { booking: { booking_id: 'b1' } }, invitees: [{ member: { username: 'ana' } }], status: { cancelled: { by: 'bo', reason: 'ill' } } });
    const mine: Event = { ...booked, id: 'b2', status: { cancelled: { by: 'ana', reason: null } } };
    const notMine: Event = { ...invite, id: 'o1', invitees: [{ member: { username: 'cy' } }] };
    const ownOfficial: Event = { ...invite, id: 'n1e', author: 'ana' };
    for (const e of [invite, booked, mine, notMine]) await bo.ports.storage.set(authored, `cal/event/${e.id}`, engine.encodeEvent(e));
    await ana.ports.storage.set({ kind: 'node', node: 'n1' }, 'cal/event/n1e', engine.encodeEvent(ownOfficial));
    start(ana, 'ana');
    for (const id of ['i1', 'b1', 'b2', 'o1', 'i1']) ana.hear({ backend: { node_authored: { node_id: 'n1', author: 'bo' } }, key: `cal/event/${id}` });
    ana.hear({ backend: { node: { node_id: 'n1' } }, key: 'cal/event/n1e' });
    await settle();
    expect(ana.notes).toEqual([
      'Invited: Retro: bo invited you · Sat, Jul 20, 11:00 AM · Engineering',
      'Booking cancelled: Intro (Mon, Jul 15, 9:00 AM) was cancelled by bo: ill',
    ]);
  });
});
