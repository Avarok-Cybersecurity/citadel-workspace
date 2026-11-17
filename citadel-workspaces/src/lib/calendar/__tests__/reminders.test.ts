/**
 * The interim reminders (design §3.7) over the real core and ports: a plan resolves each offset to
 * the instant before each occurrence, across a DST change; what falls due fires once, in the
 * leader only, however many windows run; and a reminder missed while no window was open is shown
 * once and never fired. The clock is a hand-moved fake and `fire` a counter: the two edges a test
 * must hold still; storage, codecs and the scheduler are the shipped ones.
 */
import { describe, expect, it } from 'vitest';
import type { DispatchClock } from '@/lib/citadel-apps/host/dispatch';
import type { Event } from '../generated/Event';
import { HANDLED_KEY, encodeHandled, reminderStore, ReminderRunner } from '../reminder-runner';
import { saveEvent } from '../event-save';
import { nextDue, planOf, REMINDER_PREFIX, type Due } from '../reminder-scheduler';
import { engine, member } from './booking-rig';
import { event, NY, utc } from './event-fixture';
import { IhttpRelay } from './ihttp-relay';
import type { Schedule } from '@/lib/calendar/reminder-scheduler';
import type { ReminderPlan } from '@/lib/calendar/generated/ReminderPlan';

const USER = { kind: 'user' } as const;
const at = (iso: string): bigint => utc(iso);
const meeting: Event = event({ id: 'm1', title: 'Standup', reminders: [{ minutes_before: 60 }, { minutes_before: 10 }], when: { once: { start_ms: at('2024-07-16T14:00:00Z'), end_ms: at('2024-07-16T14:30:00Z') } } });
/** Weekly at 09:00 New York from Monday 4 March 2024: the clocks change on Sunday 10 March. */
const weekly: Event = event({
  id: 'w1', title: 'Weekly', zone: NY, reminders: [{ minutes_before: 15 }],
  when: { recurring: { start: { date: { y: 2024, m: 3, d: 4 }, minute: 540 }, duration_min: 30, rule: { freq: 'weekly', interval: 1, by_day: [], by_month_day: [], count: 3 }, exdates: [], until_ms: null } },
});

function clockAt(iso: string): DispatchClock & { set: (iso: string) => void } {
  let now: number = Date.parse(iso);
  return { now: () => now, after: () => () => {}, set: (next: string): void => { now = Date.parse(next); } };
}

describe('reminder plans', () => {
  it('resolve each offset before the start, earliest first, and leave out what is already past', () => {
    expect(planOf(meeting, at('2024-07-16T13:30:00Z'), engine)).toEqual({
      event_id: 'm1', node: meeting.origin_node, title: 'Standup', fires: [{ at_ms: at('2024-07-16T13:50:00Z'), start_ms: at('2024-07-16T14:00:00Z') }],
    });
    expect(planOf(meeting, at('2024-07-16T14:00:00Z'), engine)).toBeNull();
    expect(planOf({ ...meeting, status: { cancelled: { by: 'ana', reason: null } } }, at('2024-07-01T00:00:00Z'), engine)).toBeNull();
  });

  it("follow a weekly event's local time across the change to summer time", () => {
    const plan: ReminderPlan | null = planOf(weekly, at('2024-03-01T00:00:00Z'), engine);
    expect(plan?.fires.map((f) => f.at_ms)).toEqual([at('2024-03-04T13:45:00Z'), at('2024-03-11T12:45:00Z'), at('2024-03-18T12:45:00Z')]);
    const between: Schedule = nextDue(plan ? [plan] : [], at('2024-03-05T00:00:00Z'), at('2024-03-05T00:00:00Z'));
    expect(between.nextMs).toBe(at('2024-03-11T12:45:00Z'));
  });

  it('fire when due, and count as missed once the occurrence has started', () => {
    const plan: ReminderPlan | null = planOf(meeting, at('2024-07-16T00:00:00Z'), engine);
    const plans: ReminderPlan[] = plan === null ? [] : [plan];
    const soon: Schedule = nextDue(plans, at('2024-07-16T13:55:00Z'), at('2024-07-16T12:00:00Z'));
    expect(soon.due.map((d: Due) => d.fire.at_ms)).toEqual([at('2024-07-16T13:00:00Z'), at('2024-07-16T13:50:00Z')]);
    expect(soon.missed).toEqual([]);
    const late: Schedule = nextDue(plans, at('2024-07-16T14:05:00Z'), at('2024-07-16T12:00:00Z'));
    expect([late.due.length, late.missed.length, late.nextMs]).toEqual([0, 2, null]);
  });
});

async function rig(handled: string): Promise<{ store: ReturnType<typeof reminderStore>; ports: Awaited<ReturnType<typeof member>>['ports'] }> {
  const { ports } = await member('ana', new IhttpRelay(), new Map());
  const plan: ReminderPlan | null = planOf(meeting, at('2024-07-16T00:00:00Z'), engine);
  if (plan === null) throw new Error('the meeting has no plan');
  await ports.storage.set(USER, `${REMINDER_PREFIX}m1`, engine.encodeReminderPlan(plan));
  await ports.storage.set({ kind: 'node', node: meeting.origin_node }, 'cal/event/m1', engine.encodeEvent(meeting));
  await ports.storage.set(USER, HANDLED_KEY, encodeHandled(at(handled)));
  return { store: reminderStore(ports, engine), ports };
}

describe('the reminder runner', () => {
  it('fires a due reminder once across two windows, from the leader only', async () => {
    const { store } = await rig('2024-07-16T12:30:00Z');
    const fired: Due[] = [];
    const tab = (leader: boolean): ReminderRunner => new ReminderRunner({ ...store, engine, clock: clockAt('2024-07-16T13:05:00Z'), isLeader: () => leader, fire: async (d: Due): Promise<void> => { fired.push(d); }, missed: async (): Promise<void> => {}, rescanMs: 60_000 });
    await Promise.all([tab(true).tick(), tab(false).tick()]);
    expect(fired.map((d: Due) => d.fire.at_ms)).toEqual([at('2024-07-16T13:00:00Z')]);
  });

  it('shows a reminder missed while no window was open once, and never fires it', async () => {
    const { store } = await rig('2024-07-16T12:30:00Z');
    const fired: Due[] = [];
    const clock: DispatchClock & { set: (iso: string) => void; } = clockAt('2024-07-16T15:00:00Z');
    const runner: ReminderRunner = new ReminderRunner({ ...store, engine, clock, isLeader: (): true => true, fire: async (d: Due): Promise<void> => { fired.push(d); }, missed: async (): Promise<void> => {}, rescanMs: 60_000 });
    expect((await runner.tick()).map((d: Due) => d.fire.at_ms)).toEqual([at('2024-07-16T13:00:00Z'), at('2024-07-16T13:50:00Z')]);
    expect(await runner.tick()).toEqual([]);
    expect(fired).toEqual([]);
  });
});

describe('saving an event', () => {
  it("keeps the saver's plan, and removes it once the event has no reminders", async () => {
    const { ports } = await member('ana', new IhttpRelay(), new Map());
    const key: string = `${REMINDER_PREFIX}m1`;
    const saved: Event = { ...meeting, updated_ms: at('2024-07-16T00:00:00Z') };
    const at1: Parameters<typeof saveEvent>[2] = { ok: true as const, event: saved, store: USER, key: 'cal/private/m1' };
    expect(await saveEvent(ports, engine, at1, null, () => {})).toEqual({ kind: 'saved' });
    const kept: Uint8Array | null = await ports.storage.get(USER, key);
    expect(kept === null ? null : engine.decodeReminderPlan(kept).fires.length).toBe(2);
    expect(await saveEvent(ports, engine, { ...at1, event: { ...saved, reminders: [] } }, saved, () => {})).toEqual({ kind: 'saved' });
    expect(await ports.storage.get(USER, key)).toBeNull();
  });
});
