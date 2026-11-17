/**
 * The interim reminder scheduler's edge (design §3.7): it reads the member's plans and the instant
 * reminders were last handled, fires what is due through `notify`, and waits on the clock for the
 * next, or for `rescanMs`, whichever comes first: a plan saved in another window is not announced
 * (user stores never are), so the runner looks again on its own. Only the runner that leads fires
 * and moves that instant on (calendar-background.ts holds one per account across windows), so two
 * windows never fire one reminder twice; what was missed while none was open is answered once.
 *
 * A plan is the saver's, but the event is everyone's who may edit it: before anything is fired or
 * shown, each plan is checked against its event as it is now (reminder-reconcile.ts), so a
 * reminder never fires for an event someone else cancelled, deleted or moved.
 *
 * A reminder fires only while one of the member's workspace windows is open: the limitation is
 * said where reminders are chosen, until Signals timers and the durable inbox replace this.
 */
import type { DispatchClock } from '@/lib/citadel-apps/host/dispatch';
import type { CalendarEngine } from './engine/calendar-engine';
import type { Event } from './generated/Event';
import type { ReminderPlan } from './generated/ReminderPlan';
import type { CalendarPorts, CalendarStore } from './ports';
import { EVENT_PREFIX, PRIVATE_PREFIX } from './read-sources';
import { checkPlan, type PlanCheck } from './reminder-reconcile';
import { nextDue, REMINDER_PREFIX, type Due, type Schedule } from './reminder-scheduler';

const USER: CalendarStore = { kind: 'user' };

/** `storage.user`: the instant, in UTC ms, up to which every reminder has been fired or shown. */
export const HANDLED_KEY: string = 'cal/reminders-handled';

export function encodeHandled(ms: bigint): Uint8Array {
  const bytes: Uint8Array = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, ms);
  return bytes;
}

export function decodeHandled(bytes: Uint8Array): bigint {
  if (bytes.byteLength !== 8) throw new Error(`a handled instant is 8 bytes, not ${bytes.byteLength}`);
  return new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0);
}

export interface ReminderDeps {
  readonly clock: DispatchClock;
  readonly isLeader: () => boolean;
  readonly plans: () => Promise<ReminderPlan[]>;
  /** Null before reminders were ever handled: nothing counts as missed. */
  readonly handled: () => Promise<bigint | null>;
  readonly setHandled: (ms: bigint) => Promise<void>;
  /** The plan's event as it is now, wherever it is kept; null when it is gone. */
  readonly current: (plan: ReminderPlan) => Promise<Event | null>;
  readonly replace: (plan: ReminderPlan) => Promise<void>;
  readonly drop: (eventId: string) => Promise<void>;
  readonly engine: Pick<CalendarEngine, 'expand' | 'instantOf'>;
  readonly fire: (due: Due) => Promise<void>;
  /** Told, by the leader, of reminders whose occurrence had started before they were handled: never fired. */
  readonly missed: (late: readonly Due[]) => Promise<void>;
  /** The longest the runner waits before reading the plans again. */
  readonly rescanMs: number;
}

/** The runner's deps over the Calendar's own ports; `isLeader` and `fire` are the mount's. */
export function reminderStore(ports: CalendarPorts, engine: Pick<CalendarEngine, 'decodeReminderPlan' | 'encodeReminderPlan' | 'decodeEvent'>): Pick<ReminderDeps, 'plans' | 'handled' | 'setHandled' | 'current' | 'replace' | 'drop'> {
  return {
    current: (plan: ReminderPlan): Promise<Event | null> => eventNow(ports, engine, plan),
    replace: (plan: ReminderPlan): Promise<void> => ports.storage.set(USER, `${REMINDER_PREFIX}${plan.event_id}`, engine.encodeReminderPlan(plan)),
    drop: (eventId: string): Promise<void> => ports.storage.remove(USER, `${REMINDER_PREFIX}${eventId}`),
    plans: async (): Promise<ReminderPlan[]> => {
      const keys: string[] = await ports.storage.keys(USER, REMINDER_PREFIX);
      const values: (Uint8Array | null)[] = await Promise.all(keys.map((k: string) => ports.storage.get(USER, k)));
      return values.flatMap((bytes) => {
        if (bytes === null) return [];
        try {
          return [engine.decodeReminderPlan(bytes)];
        } catch (e: unknown) {
          console.error('[calendar] a reminder plan could not be read', e);
          return [];
        }
      });
    },
    handled: async (): Promise<bigint | null> => {
      const bytes: Uint8Array | null = await ports.storage.get(USER, HANDLED_KEY);
      return bytes === null ? null : decodeHandled(bytes);
    },
    setHandled: (ms: bigint): Promise<void> => ports.storage.set(USER, HANDLED_KEY, encodeHandled(ms)),
  };
}

export class ReminderRunner {
  private cancel: (() => void) | null = null;
  private stopped: boolean = false;

  constructor(private readonly deps: ReminderDeps) {}

  /**
   * Handles what is due now and waits for the next; answers what was missed, which the leader
   * has already passed to `missed`.
   */
  async tick(): Promise<Due[]> {
    this.cancel?.();
    this.cancel = null;
    const now: bigint = BigInt(Math.floor(this.deps.clock.now()));
    const [stored, since] = await Promise.all([this.deps.plans(), this.deps.handled()]);
    const plans: ReminderPlan[] = await this.checked(stored, since ?? now);
    const schedule: Schedule = nextDue(plans, now, since ?? now);
    if (this.deps.isLeader()) {
      for (const due of schedule.due) await this.deps.fire(due);
      if (schedule.missed.length > 0) await this.deps.missed(schedule.missed);
      await this.deps.setHandled(now);
    }
    if (!this.stopped) {
      const wait: number = schedule.nextMs === null ? this.deps.rescanMs : Math.min(Number(schedule.nextMs - now), this.deps.rescanMs);
      this.cancel = this.deps.clock.after(wait, (): void => {
        this.tick().catch((e: unknown): void => console.error('[calendar] reminders could not be handled', e));
      });
    }
    return schedule.missed;
  }

  /**
   * The plans as their events are now. Only the leader writes what changed; a plan whose event
   * cannot be read is neither fired nor shown this time, and is said.
   */
  private async checked(stored: readonly ReminderPlan[], sinceMs: bigint): Promise<ReminderPlan[]> {
    const kept: ReminderPlan[] = [];
    for (const plan of stored) {
      let check: PlanCheck;
      try {
        check = checkPlan(plan, await this.deps.current(plan), sinceMs, this.deps.engine);
      } catch (e: unknown) {
        console.error('[calendar] a reminder\'s event could not be read, so it was not fired', e);
        continue;
      }
      if (check.kind === 'keep') kept.push(plan);
      if (check.kind === 'replace') kept.push(check.plan);
      if (!this.deps.isLeader()) continue;
      if (check.kind === 'replace') await this.deps.replace(check.plan);
      if (check.kind === 'drop') await this.deps.drop(plan.event_id);
    }
    return kept;
  }

  stop(): void {
    this.stopped = true;
    this.cancel?.();
    this.cancel = null;
  }
}

/** Where an event is kept, in the order a member's own copy wins: theirs, the node's, an author's on the node. */
async function eventNow(ports: CalendarPorts, engine: Pick<CalendarEngine, 'decodeEvent'>, plan: ReminderPlan): Promise<Event | null> {
  const own: Uint8Array | null = await ports.storage.get(USER, `${PRIVATE_PREFIX}${plan.event_id}`);
  if (own !== null) return engine.decodeEvent(own);
  const key: string = `${EVENT_PREFIX}${plan.event_id}`;
  const onNode: Uint8Array | null = await ports.storage.get({ kind: 'node', node: plan.node }, key);
  if (onNode !== null) return engine.decodeEvent(onNode);
  for (const k of await ports.storage.authoredKeys(plan.node, key)) {
    if (k.key !== key) continue;
    const bytes: Uint8Array | null = await ports.storage.get({ kind: 'authored', node: plan.node, author: k.author }, key);
    if (bytes !== null) return engine.decodeEvent(bytes);
  }
  return null;
}
