/**
 * While the agent takes app notices, the window that runs the Calendar's work hands it the
 * member's reminders and fires none itself (calendar-background.ts, reminder-runner.ts). It tells
 * the agent the whole set when it changes and whenever the agent comes to take them again, and
 * fires them itself when the agent refuses them or stops taking them: a duplicate at worst, never a
 * silence. The rig's store, clock and notify port are the stand-ins (notice-rig.ts); the agent's
 * side records what it is told (no agent in CI), over a real ValueStore for whether it takes them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AppNotice } from 'citadel-internal-service-wasm-client';
import { createValueStore, type ValueStore } from '@/lib/value-store';
import { startCalendarBackground, type AgentReminders } from '../calendar-background';
import { reminderId } from '../agent-reminders';
import type { Event } from '../generated/Event';
import type { ReminderPlan } from '../generated/ReminderPlan';
import { encodeHandled, HANDLED_KEY } from '../reminder-runner';
import { planOf, REMINDER_PREFIX } from '../reminder-scheduler';
import { realEngine } from './engine-rig';
import { event, NY, utc } from './event-fixture';
import { noticeMember, settle, type NoticeMember } from './notice-rig';
import type { CalendarEngine } from '../engine/calendar-engine';

const engine: CalendarEngine = realEngine();
const NOW: string = '2024-07-16T13:00:00Z';
const stops: (() => void)[] = [];
afterEach(() => { stops.splice(0).forEach((stop) => stop()); });

interface Agent { side: AgentReminders; takes: ValueStore<boolean>; told: AppNotice[][]; refuses: boolean; listening: number }

function agent(takesAtStart: boolean): Agent {
  const a: Agent = {
    takes: createValueStore<boolean>('test-agent-takes', takesAtStart), told: [], refuses: false, listening: 0,
    side: undefined as unknown as AgentReminders,
  };
  a.side = {
    takes: (): boolean => a.takes.get(),
    onTakesChange: (l: () => void): (() => void) => a.takes.subscribe(l),
    sync: async (notices: readonly AppNotice[]): Promise<void> => {
      if (a.refuses) throw new Error('refused');
      a.told.push([...notices]);
    },
    listFired: (): (() => void) => { a.listening += 1; return (): void => { a.listening -= 1; }; },
  };
  return a;
}

const standup: Event = event({ id: 'm1', author: 'ana', title: 'Standup', reminders: [{ minutes_before: 10 }], when: { once: { start_ms: utc('2024-07-16T13:15:00Z'), end_ms: utc('2024-07-16T13:30:00Z') } } });

async function member(): Promise<NoticeMember> {
  const ana: NoticeMember = noticeMember('ana', new Map(), Date.parse(NOW));
  const plan: ReminderPlan | null = planOf(standup, utc('2024-07-16T00:00:00Z'), engine);
  if (plan === null) throw new Error('no plan');
  await ana.ports.storage.set({ kind: 'node', node: 'n1' }, 'cal/event/m1', engine.encodeEvent(standup));
  await ana.ports.storage.set({ kind: 'user' }, `${REMINDER_PREFIX}m1`, engine.encodeReminderPlan(plan));
  await ana.ports.storage.set({ kind: 'user' }, HANDLED_KEY, encodeHandled(utc(NOW)));
  return ana;
}

function start(m: NoticeMember, a: Agent): void {
  stops.push(startCalendarBackground({
    ports: m.ports, engine, me: 'ana', nodeName: (id: string) => (id === 'n1' ? 'Engineering' : id), deviceZone: NY,
    report: (what: string, e: unknown): void => { throw new Error(`${what}: ${String(e)}`); }, agent: a.side,
  }));
}

async function minutes(m: NoticeMember, n: number): Promise<void> {
  for (let i: number = 0; i < n; i += 1) {
    m.clock.advance(60_000);
    await settle();
  }
}

describe('reminders while the agent takes app notices', () => {
  it('are handed to the agent, by the id the browser shows them under, and not fired by the window', async () => {
    const ana: NoticeMember = await member();
    const a: Agent = agent(true);
    start(ana, a);
    await minutes(ana, 6);
    expect(ana.notes).toEqual([]);
    expect(a.told[0].map((n: AppNotice) => [n.id, n.title, n.body])).toEqual([[reminderId('m1', utc('2024-07-16T13:05:00Z')), 'Standup', 'Starts at 9:15 AM · Engineering']]);
  });

  it('are told once while they stay the same, and again when the agent comes to take them again', async () => {
    const ana: NoticeMember = await member();
    const a: Agent = agent(true);
    start(ana, a);
    await minutes(ana, 3);
    expect(a.told).toHaveLength(1);
    a.takes.set(false);
    a.takes.set(true);
    await settle();
    expect(a.told).toHaveLength(2);
  });

  it('are fired by the window when the agent refuses them', async () => {
    const ana: NoticeMember = await member();
    const a: Agent = agent(true);
    a.refuses = true;
    start(ana, a);
    await minutes(ana, 6);
    expect(ana.notes).toEqual(['Standup: Starts at 9:15 AM · Engineering']);
  });

  it('are fired by the window once the agent stops taking them', async () => {
    const ana: NoticeMember = await member();
    const a: Agent = agent(true);
    start(ana, a);
    await settle();
    a.takes.set(false);
    await minutes(ana, 6);
    expect(ana.notes).toEqual(['Standup: Starts at 9:15 AM · Engineering']);
  });

  it('are listed from the agent only while the work runs', async () => {
    const ana: NoticeMember = await member();
    const a: Agent = agent(true);
    start(ana, a);
    expect(a.listening).toBe(1);
    stops.splice(0).forEach((stop) => stop());
    expect(a.listening).toBe(0);
  });
});
