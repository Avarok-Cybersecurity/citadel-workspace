/**
 * A reminder plan against its event as it is now (design §3.7), pure: a plan is resolved when its
 * saver saves, but anyone who may edit the event can cancel, delete or move it afterwards, and the
 * plan does not follow. Before anything fires, the runner (reminder-runner.ts) reads the event
 * again and asks this: a cancelled or deleted event drops the plan; a moved or retitled one has its
 * reminders resolved again from the same instant the runner handles from, so nothing that falls due
 * now is lost; anything else keeps the plan as it is.
 */
import type { CalendarEngine } from './engine/calendar-engine';
import type { Event } from './generated/Event';
import type { Fire } from './generated/Fire';
import type { ReminderPlan } from './generated/ReminderPlan';
import { planOf } from './reminder-scheduler';

export type PlanCheck =
  | { readonly kind: 'keep' }
  | { readonly kind: 'drop' }
  | { readonly kind: 'replace'; readonly plan: ReminderPlan };

const ahead = (fires: readonly Fire[], sinceMs: bigint, untilMs: bigint): string =>
  fires.filter((f: Fire) => f.at_ms > sinceMs && f.at_ms <= untilMs).map((f: Fire) => `${f.at_ms}:${f.start_ms}`).join(',');
const lastOf = (fires: readonly Fire[]): bigint => fires.reduce((m: bigint, f: Fire) => (f.at_ms > m ? f.at_ms : m), 0n);

/**
 * `current` is the event read now, or null when it is gone. The plans are compared over the span
 * both cover from `sinceMs`, since a recurring event's plan reaches only so far ahead of the instant
 * it was resolved at: two resolutions of an unmoved event agree there, a moved one does not.
 */
export function checkPlan(plan: ReminderPlan, current: Event | null, sinceMs: bigint, engine: Pick<CalendarEngine, 'expand' | 'instantOf'>): PlanCheck {
  if (current === null) return { kind: 'drop' };
  const fresh: ReminderPlan | null = planOf(current, sinceMs, engine);
  if (fresh === null) return { kind: 'drop' };
  const until: bigint = lastOf(plan.fires) < lastOf(fresh.fires) ? lastOf(plan.fires) : lastOf(fresh.fires);
  const same: boolean = fresh.title === plan.title && fresh.node === plan.node && ahead(plan.fires, sinceMs, until) === ahead(fresh.fires, sinceMs, until);
  return same ? { kind: 'keep' } : { kind: 'replace', plan: fresh };
}
