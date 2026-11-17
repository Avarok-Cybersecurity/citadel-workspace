/**
 * Saving a change to an event already stored (event-edit.ts decides what the change is): the edit
 * or the cancellation goes through `saveEvent` with the stored event as `before`, so the pages
 * below are brought in line with it, and a cancelled event's projections removed from them.
 */
import type { CalendarEngine } from './engine/calendar-engine';
import { cancelled, revise, storedAt } from './event-edit';
import { saveEvent, type SaveOutcome, type Saving } from './event-save';
import type { Progress } from './fan-out';
import type { CalendarPorts } from './ports';
import type { EventEntry } from './store';

const QUIET: Progress = (): void => {};

/** Saves `checked` (the editor's form) as the next revision of `entry`'s event. */
export function saveRevision(ports: CalendarPorts, engine: CalendarEngine, entry: EventEntry, checked: Saving, progress: Progress): Promise<SaveOutcome> {
  return saveEvent(ports, engine, revise(entry.event, storedAt(entry), checked), entry.event, progress);
}

/** Cancels `entry`'s event as `me`; null once it is cancelled everywhere, else the sentence that says what happened. */
export async function cancelEvent(ports: CalendarPorts, engine: CalendarEngine, entry: EventEntry, me: string, reason: string | null, nowMs: bigint, nodeName: (id: string) => string): Promise<string | null> {
  const outcome: SaveOutcome = await saveEvent(ports, engine, cancelled(entry.event, storedAt(entry), me, reason, nowMs), entry.event, QUIET);
  if (outcome.kind === 'saved') return null;
  if (outcome.kind === 'refused') return `The event was not cancelled: ${outcome.reason}.`;
  const pages: string = outcome.failed.map((f) => `${nodeName(f.node)} (${f.reason})`).join(', ');
  return `The event is cancelled, but it could not be taken off ${outcome.failed.length === 1 ? 'one page' : `${outcome.failed.length} pages`} below: ${pages}.`;
}
