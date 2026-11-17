/**
 * Keeping a member's reminder plans (design §3.7): when they save an event, its reminders are
 * resolved to instants (`planOf`) and kept in their own storage at `cal/reminders/<event_id>`;
 * an event left with none, cancelled, or with nothing still ahead has its plan removed, so the
 * scheduler never fires for it. The plan is the saver's alone: the reminders are theirs.
 */
import type { ReminderPlan } from './generated/ReminderPlan';
import type { CalendarEngine } from './engine/calendar-engine';
import type { Event } from './generated/Event';
import type { CalendarPorts, CalendarStore } from './ports';
import { planOf, REMINDER_PREFIX } from './reminder-scheduler';

const USER: CalendarStore = { kind: 'user' };

/**
 * Resolved as of the save (`updated_ms`), the instant the event's reminders were chosen at.
 * `before`: the event as stored, when this save replaces one; with no reminders either side there
 * is no plan to keep or remove, and nothing is written.
 */
export async function keepPlan(ports: CalendarPorts, engine: Pick<CalendarEngine, 'expand' | 'instantOf' | 'encodeReminderPlan'>, event: Event, before: Event | null): Promise<void> {
  if (event.reminders.length === 0 && (before?.reminders.length ?? 0) === 0) return;
  const key: string = `${REMINDER_PREFIX}${event.id}`;
  const plan: ReminderPlan | null = planOf(event, event.updated_ms, engine);
  if (plan === null) await ports.storage.remove(USER, key);
  else await ports.storage.set(USER, key, engine.encodeReminderPlan(plan));
}
