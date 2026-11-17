/**
 * The interim reminder scheduler's decisions (design §3.7), pure: an event's reminders resolved to
 * UTC instants when it is saved (`planOf`, a `ReminderPlan` the member keeps at
 * `cal/reminders/<event_id>`), and, from every plan and the instant reminders were last handled,
 * which fire now, which were missed and when to look again (`nextDue`).
 *
 * A reminder is missed when its occurrence has already started by the time it is handled, that is
 * when it is late by more than its own offset: it is shown once, in "While you were away", and
 * never fired as if it were on time. Nothing here reads a clock or a store (reminder-runner.ts).
 */
import type { CalendarEngine } from './engine/calendar-engine';
import type { Event } from './generated/Event';
import type { Fire } from './generated/Fire';
import type { ReminderPlan } from './generated/ReminderPlan';

/** `MAX_FIRES` in the core's reminder.rs. */
export const MAX_FIRES: number = 64;
export const REMINDER_PREFIX: string = 'cal/reminders/';
/** How far ahead a recurring event's reminders are resolved; the plan is resolved again on each save. */
export const PLAN_HORIZON_MS: bigint = 90n * 86_400_000n;

export interface Due {
  readonly eventId: string;
  readonly node: string;
  readonly title: string;
  readonly fire: Fire;
}

export interface Schedule {
  /** Fire now: their occurrence has not started. */
  readonly due: Due[];
  /** Show once, never fire: their occurrence had started before they were handled. */
  readonly missed: Due[];
  /** The next instant a reminder falls due, or null when none is left. */
  readonly nextMs: bigint | null;
}

const MS_PER_MIN: bigint = 60_000n;
const byAt = (a: Fire, b: Fire): number => (a.at_ms < b.at_ms ? -1 : a.at_ms > b.at_ms ? 1 : 0);

/** The starts of `event`'s occurrences from `fromMs`, over the horizon. */
function startsOf(event: Event, fromMs: bigint, engine: Pick<CalendarEngine, 'expand' | 'instantOf'>): bigint[] {
  if ('once' in event.when) return [event.when.once.start_ms];
  if ('all_day' in event.when) return [engine.instantOf(event.zone, { date: event.when.all_day.date, minute: 0 })];
  return engine.expand(event.when.recurring, event.zone, fromMs, fromMs + PLAN_HORIZON_MS).occurrences.map((o) => o.start_ms);
}

/**
 * The plan for `event` as saved at `nowMs`: every offset before every occurrence still to come,
 * the earliest `MAX_FIRES`. Null when there is nothing to remind of: no offsets, a cancelled
 * event, or none of its reminders still ahead.
 */
export function planOf(event: Event, nowMs: bigint, engine: Pick<CalendarEngine, 'expand' | 'instantOf'>): ReminderPlan | null {
  if (event.reminders.length === 0 || event.status !== 'confirmed') return null;
  const fires: Fire[] = [];
  for (const start of startsOf(event, nowMs, engine)) {
    for (const r of event.reminders) {
      const at: bigint = start - BigInt(r.minutes_before) * MS_PER_MIN;
      if (at > nowMs) fires.push({ at_ms: at, start_ms: start });
    }
  }
  if (fires.length === 0) return null;
  return { event_id: event.id, node: event.origin_node, title: event.title, fires: fires.sort(byAt).slice(0, MAX_FIRES) };
}

/** What falls due in `(sinceMs, nowMs]`, and when to look next. */
export function nextDue(plans: readonly ReminderPlan[], nowMs: bigint, sinceMs: bigint): Schedule {
  const due: Due[] = [];
  const missed: Due[] = [];
  let nextMs: bigint | null = null;
  for (const plan of plans) {
    for (const fire of plan.fires) {
      const at: Due = { eventId: plan.event_id, node: plan.node, title: plan.title, fire };
      if (fire.at_ms > nowMs) nextMs = nextMs === null || fire.at_ms < nextMs ? fire.at_ms : nextMs;
      else if (fire.at_ms > sinceMs) (fire.start_ms <= nowMs ? missed : due).push(at);
    }
  }
  const order = (a: Due, b: Due): number => byAt(a.fire, b.fire);
  return { due: due.sort(order), missed: missed.sort(order), nextMs };
}
