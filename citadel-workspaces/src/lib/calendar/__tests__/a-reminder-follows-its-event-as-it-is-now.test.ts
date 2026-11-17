/**
 * A reminder follows its event as it is now (design §3.7): the plan is the saver's, but another
 * editor may cancel, delete or move the event afterwards. Before firing, the runner reads the event
 * again: a cancelled or deleted one fires nothing and its plan is removed; a moved one fires for its
 * new time and its plan is resolved again; one nobody touched fires as planned.
 */
import { describe, expect, it } from 'vitest';
import type { DispatchClock } from '@/lib/citadel-apps/host/dispatch';
import type { Event } from '../generated/Event';
import { encodeHandled, HANDLED_KEY, reminderStore, ReminderRunner } from '../reminder-runner';
import { checkPlan } from '../reminder-reconcile';
import { planOf, REMINDER_PREFIX, type Due } from '../reminder-scheduler';
import { engine, member, type Member } from './booking-rig';
import { event, NY, utc } from './event-fixture';
import { IhttpRelay } from './ihttp-relay';
import type { ReminderPlan } from '@/lib/calendar/generated/ReminderPlan';

const USER = { kind: 'user' } as const;
const NODE = { kind: 'node', node: 'n1' } as const;
const KEY: "cal/event/m1" = 'cal/event/m1';
const once = (iso: string): Event['when'] => ({ once: { start_ms: utc(iso), end_ms: utc(iso) + 1_800_000n } });
const meeting: Event = event({ id: 'm1', author: 'ana', title: 'Standup', reminders: [{ minutes_before: 10 }], when: once('2024-07-16T14:00:00Z') });
const clock: DispatchClock = { now: () => Date.parse('2024-07-16T13:55:00Z'), after: () => () => {} };

async function rig(): Promise<{ ana: Member; bo: Member; fired: Due[]; tick: () => Promise<Due[]> }> {
  const relay: IhttpRelay = new IhttpRelay();
  const shared: Map<string, Uint8Array> = new Map();
  const [ana, bo] = await Promise.all([member('ana', relay, shared), member('bo', relay, shared)]);
  const plan: ReminderPlan | null = planOf(meeting, utc('2024-07-16T00:00:00Z'), engine);
  if (plan === null) throw new Error('the meeting has no plan');
  await ana.ports.storage.set(NODE, KEY, engine.encodeEvent(meeting));
  await ana.ports.storage.set(USER, `${REMINDER_PREFIX}m1`, engine.encodeReminderPlan(plan));
  await ana.ports.storage.set(USER, HANDLED_KEY, encodeHandled(utc('2024-07-16T13:00:00Z')));
  const fired: Due[] = [];
  const runner: ReminderRunner = new ReminderRunner({ ...reminderStore(ana.ports, engine), engine, clock, isLeader: (): true => true, fire: async (d: Due): Promise<void> => { fired.push(d); }, missed: async (): Promise<void> => {}, rescanMs: 60_000 });
  return { ana, bo, fired, tick: () => runner.tick() };
}

const planIn = async (ana: Member): Promise<bigint[] | null> => {
  const bytes: Uint8Array | null = await ana.ports.storage.get(USER, `${REMINDER_PREFIX}m1`);
  return bytes === null ? null : engine.decodeReminderPlan(bytes).fires.map((f) => f.start_ms);
};

describe("a member's reminder, after someone else changed the event", () => {
  it('fires as planned when nobody touched it', async () => {
    const { ana, fired, tick } = await rig();
    await tick();
    expect(fired.map((d: Due) => d.fire.start_ms)).toEqual([utc('2024-07-16T14:00:00Z')]);
    expect(await planIn(ana)).toEqual([utc('2024-07-16T14:00:00Z')]);
  });

  it('fires nothing for an event another editor cancelled, and the plan is removed', async () => {
    const { ana, bo, fired, tick } = await rig();
    await bo.ports.storage.set(NODE, KEY, engine.encodeEvent({ ...meeting, rev: 2, status: { cancelled: { by: 'bo', reason: null } } }));
    expect([await tick(), fired]).toEqual([[], []]);
    expect(await planIn(ana)).toBeNull();
  });

  it('fires nothing for an event another editor deleted, and the plan is removed', async () => {
    const { ana, bo, fired, tick } = await rig();
    await bo.ports.storage.remove(NODE, KEY);
    expect([await tick(), fired]).toEqual([[], []]);
    expect(await planIn(ana)).toBeNull();
  });

  it('fires for the new time of an event another editor moved, and the plan is resolved again', async () => {
    const { ana, bo, fired, tick } = await rig();
    await bo.ports.storage.set(NODE, KEY, engine.encodeEvent({ ...meeting, rev: 2, when: once('2024-07-16T14:03:00Z') }));
    await tick();
    expect(fired.map((d: Due) => d.fire.start_ms)).toEqual([utc('2024-07-16T14:03:00Z')]);
    expect(await planIn(ana)).toEqual([utc('2024-07-16T14:03:00Z')]);
  });

  it("keeps an untouched weekly event's plan, though a later look resolves further ahead", () => {
    const weekly: Event = event({
      id: 'w1', zone: NY, reminders: [{ minutes_before: 15 }],
      when: { recurring: { start: { date: { y: 2024, m: 3, d: 4 }, minute: 540 }, duration_min: 30, rule: { freq: 'weekly', interval: 1, by_day: [], by_month_day: [], count: null }, exdates: [], until_ms: null } },
    });
    const plan: ReminderPlan | null = planOf(weekly, utc('2024-03-01T00:00:00Z'), engine);
    if (plan === null) throw new Error('the weekly event has no plan');
    expect(checkPlan(plan, weekly, utc('2024-04-01T00:00:00Z'), engine)).toEqual({ kind: 'keep' });
  });
});
