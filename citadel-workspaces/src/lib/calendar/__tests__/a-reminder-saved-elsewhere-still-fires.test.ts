/**
 * A reminder saved in another window fires on time in the window that runs the reminders. A user
 * store's writes are never announced, so the runner cannot hear the save: it reads the plans again
 * within `rescanMs` on its own clock. Before, with no plan due it set no timer at all, and a
 * reminder saved elsewhere waited for this window's next unrelated tick.
 */
import { describe, expect, it } from 'vitest';
import { ManualClock } from '@/lib/citadel-apps/host/__tests__/fakes';
import type { Event } from '../generated/Event';
import { encodeHandled, HANDLED_KEY, reminderStore, ReminderRunner } from '../reminder-runner';
import { planOf, REMINDER_PREFIX, type Due } from '../reminder-scheduler';
import { engine, member } from './booking-rig';
import { event, utc } from './event-fixture';
import { IhttpRelay } from './ihttp-relay';
import type { ReminderPlan } from '@/lib/calendar/generated/ReminderPlan';

const USER = { kind: 'user' } as const;
const START: string = '2024-07-16T13:00:00Z';
const meeting: Event = event({ id: 'm1', author: 'ana', title: 'Standup', reminders: [{ minutes_before: 5 }], when: { once: { start_ms: utc('2024-07-16T13:10:00Z'), end_ms: utc('2024-07-16T13:30:00Z') } } });
const settle = async (): Promise<void> => { for (let i: number = 0; i < 30; i += 1) await new Promise<void>((r) => { setTimeout(r, 0); }); };

describe('a reminder saved in another window', () => {
  it('fires within the rescan, with no tick from anyone', async () => {
    const { ports } = await member('ana', new IhttpRelay(), new Map());
    await ports.storage.set({ kind: 'node', node: meeting.origin_node }, 'cal/event/m1', engine.encodeEvent(meeting));
    await ports.storage.set(USER, HANDLED_KEY, encodeHandled(utc(START)));
    const clock: ManualClock = new ManualClock(Date.parse(START));
    const fired: Due[] = [];
    const runner: ReminderRunner = new ReminderRunner({ ...reminderStore(ports, engine), engine, clock, isLeader: (): true => true, fire: async (d: Due): Promise<void> => { fired.push(d); }, missed: async (): Promise<void> => {}, rescanMs: 60_000 });
    await runner.tick();
    // Saved elsewhere: only the plan in the member's own storage, which nothing announces.
    const plan: ReminderPlan | null = planOf(meeting, utc(START), engine);
    if (plan === null) throw new Error('the meeting has no plan');
    await ports.storage.set(USER, `${REMINDER_PREFIX}m1`, engine.encodeReminderPlan(plan));
    for (let minute: number = 0; minute < 6; minute += 1) {
      clock.advance(60_000);
      await settle();
    }
    expect(fired.map((d: Due) => d.title)).toEqual(['Standup']);
    runner.stop();
  });
});
