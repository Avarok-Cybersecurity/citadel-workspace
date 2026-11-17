/**
 * Saving an event where the editor checked it should go (event-draft.ts), and then what saving
 * implies (design 3.5): the other windows are told on the `cal` topic, and an official event that
 * propagates down (or did, and no longer does) is fanned out to the pages below.
 *
 * The saver's reminders for it are resolved and kept, or dropped once it has none (reminder-plans.ts).
 *
 * The fan-out is planned before the event is written, so an event the core will not propagate
 * (more pages below than its bound) is refused whole rather than saved half-shown. After the
 * write, each page the kernel refuses is reported; the event itself stays saved, and saving it
 * again retries them.
 */
import { announce } from './cal-topic';
import { CalendarRefusal, type CalendarEngine } from './engine/calendar-engine';
import type { EventCheck } from './event-draft';
import { applyFanOut, planFanOut, type FanOutFailure, type Progress } from './fan-out';
import type { Event } from './generated/Event';
import type { Write } from './generated/Write';
import { PortRefused, refusalCopy, type CalendarPorts } from './ports';
import { keepPlan } from './reminder-plans';
import type { FanOutResult } from '@/lib/calendar/fan-out';

export type SaveOutcome =
  | { readonly kind: 'saved' }
  | { readonly kind: 'refused'; readonly reason: string }
  /** Saved, and not shown on these pages below. */
  | { readonly kind: 'partly'; readonly failed: readonly FanOutFailure[] };

export type Saving = Extract<EventCheck, { ok: true }>;

function refusedCopy(error: unknown): string {
  if (error instanceof PortRefused) return refusalCopy(error.refused);
  if (error instanceof CalendarRefusal && error.code === 'too_many_nodes') return 'there are more pages below this one than an event can be shown on, so pick a page closer to where it matters';
  if (error instanceof CalendarRefusal) return `the calendar refused it (${error.code})`;
  throw error;
}

/** `before`: the event as it was stored, when this save replaces one. */
export async function saveEvent(ports: CalendarPorts, engine: CalendarEngine, saving: Saving, before: Event | null, progress: Progress): Promise<SaveOutcome> {
  const { event, store, key } = saving;
  const fans: boolean = store.kind === 'node' && (event.propagate.down || before?.propagate.down === true);
  let plan: Write[] = [];
  try {
    if (fans) plan = await planFanOut(ports, engine, event);
    await ports.storage.set(store, key, engine.encodeEvent(event));
  } catch (error: unknown) {
    return { kind: 'refused', reason: refusedCopy(error) };
  }
  try {
    await keepPlan(ports, engine, event, before);
  } catch (error: unknown) {
    return { kind: 'refused', reason: `it was saved, but its reminders were not: ${refusedCopy(error)}` };
  }
  if (store.kind !== 'user') await announce(ports, engine, { node: event.origin_node, key });
  if (plan.length === 0) return { kind: 'saved' };
  const result: FanOutResult = await applyFanOut(ports, engine, plan, progress);
  return result.failed.length === 0 ? { kind: 'saved' } : { kind: 'partly', failed: result.failed };
}
