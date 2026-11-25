/**
 * The Calendar's "now" is the date, not the page's monotonic clock. A glue instance is given two
 * clocks: the dispatch clock (performance.now() on a page: time since it loaded) paces calls and
 * times waits, and the wall clock (epoch ms) says what day it is. Reading the first as a date put
 * every member's Calendar on 1 January 1970 and no reminder ever came due.
 *
 * The real glue instance, ports and reminder runner over an in-memory store; the clocks are the
 * stand-ins, held far apart so that reading the wrong one cannot pass.
 */
import { describe, expect, it } from 'vitest';
import type { Capability } from '@/lib/citadel-apps/host/capabilities';
import { glueInstance } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY } from '@/lib/citadel-apps/host/limits';
import { ManualClock } from '@/lib/citadel-apps/host/__tests__/fakes';
import type { Event } from '../generated/Event';
import { calendarPorts, type CalendarPorts } from '../ports';
import { encodeHandled, HANDLED_KEY, reminderStore, ReminderRunner } from '../reminder-runner';
import { planOf, REMINDER_PREFIX, type Due } from '../reminder-scheduler';
import type { ReminderPlan } from '../generated/ReminderPlan';
import { engine } from './booking-rig';
import { event, utc } from './event-fixture';
import { MemoryStore } from './memory-store';

const HELD: Capability[] = ['storage.user', 'storage.node', 'storage.node.authored'];
/** A page loaded five seconds ago reads 5 000 on its dispatch clock. */
const SINCE_LOAD: number = 5_000;
const WALL_START: string = '2026-11-25T13:00:00Z';

function rig(): { ports: CalendarPorts; clock: ManualClock; store: MemoryStore } {
  const store: MemoryStore = new MemoryStore('ana');
  const clock: ManualClock = new ManualClock(SINCE_LOAD);
  // The wall clock moves with the dispatch clock, as a page's two clocks do, from a fixed date.
  const wallNow = (): number => Date.parse(WALL_START) + (clock.now() - SINCE_LOAD);
  const ports: CalendarPorts = calendarPorts(glueInstance({
    appId: 'net.avarok.calendar', ports: { storage: store.port() }, held: new Set<Capability>(HELD), policy: STANDARD_HOST_POLICY,
    limits: { topics: null, p2p: null }, clock, wallNow, pageUrl: 'https://w.example/n1', storageChanges: () => () => {},
  }));
  return { ports, clock, store };
}

const settle = async (): Promise<void> => { for (let i: number = 0; i < 30; i += 1) await new Promise<void>((r) => { setTimeout(r, 0); }); };

describe("the Calendar's clock", () => {
  it("reads the date from the wall clock and waits on the dispatch clock", () => {
    const { ports, clock } = rig();
    expect(ports.clock.now()).toBe(Date.parse(WALL_START));
    let fired: boolean = false;
    ports.clock.after(1_000, (): void => { fired = true; });
    clock.advance(999);
    expect(fired).toBe(false);
    clock.advance(1);
    expect(fired).toBe(true);
    expect(ports.clock.now()).toBe(Date.parse(WALL_START) + 1_000);
  });

  it('brings a reminder due by the date', async () => {
    const { ports, clock } = rig();
    const meeting: Event = event({ id: 'm1', author: 'ana', title: 'Standup', reminders: [{ minutes_before: 5 }], when: { once: { start_ms: utc('2026-11-25T13:10:00Z'), end_ms: utc('2026-11-25T13:30:00Z') } } });
    await ports.storage.set({ kind: 'node', node: meeting.origin_node }, 'cal/event/m1', engine.encodeEvent(meeting));
    await ports.storage.set({ kind: 'user' }, HANDLED_KEY, encodeHandled(utc(WALL_START)));
    const plan: ReminderPlan | null = planOf(meeting, utc(WALL_START), engine);
    if (plan === null) throw new Error('the meeting has no plan');
    await ports.storage.set({ kind: 'user' }, `${REMINDER_PREFIX}m1`, engine.encodeReminderPlan(plan));
    const fired: Due[] = [];
    const runner: ReminderRunner = new ReminderRunner({
      ...reminderStore(ports, engine), engine, clock: ports.clock, isLeader: (): true => true,
      fire: async (d: Due): Promise<void> => { fired.push(d); }, missed: async (): Promise<void> => {}, rescanMs: 60_000,
    });
    await runner.tick();
    for (let minute: number = 0; minute < 6; minute += 1) {
      clock.advance(60_000);
      await settle();
    }
    expect(fired.map((d: Due) => d.title)).toEqual(['Standup']);
    runner.stop();
  });
});
