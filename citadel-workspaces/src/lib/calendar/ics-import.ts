/**
 * An .ics file a member opened in the Calendar (lib/citadel-apps/runtime/opened-files.ts), read
 * into drafts by the core (`importIcs`, design owner decision 7) for the member to review: nothing
 * is written until they confirm. Confirmed drafts become the member's own private events
 * (`storage.user`, `cal/private/<id>`), saved by the editor's own path (event-save.ts), so an import
 * never posts on a node or pushes anything down. A cancelled VEVENT is not imported as an event.
 *
 * A floating time in the file (no zone of its own) is read in the zone the dialog names: the
 * member's display zone. The engine, the ports, every id and the clock are passed in (SBIO).
 */
import { CalendarRefusal, type CalendarEngine } from './engine/calendar-engine';
import type { Draft } from './generated/Draft';
import type { Event } from './generated/Event';
import type { Imported } from './generated/Imported';
import type { RefusalCode } from './generated/RefusalCode';
import type { Skipped } from './generated/Skipped';
import { formatDayLong, formatTimeIn } from './format';
import { saveEvent, type SaveOutcome, type Saving } from './event-save';
import type { CalendarPorts } from './ports';
import { PRIVATE_PREFIX } from './read-sources';

export type IcsReading =
  | { readonly ok: true; readonly drafts: readonly Draft[]; readonly skipped: readonly Skipped[]; readonly cancelled: number }
  | { readonly ok: false; readonly why: string };

const NOT_READ: Readonly<Partial<Record<RefusalCode, string>>> = {
  too_large: 'it is larger than the Calendar reads',
  not_a_calendar: 'it is not a calendar file',
  too_many_events: 'it holds more events than the Calendar can import at once',
};

export function readIcs(engine: Pick<CalendarEngine, 'importIcs'>, bytes: Uint8Array, floatingZone: string): IcsReading {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, why: 'it is not UTF-8 text' };
  }
  let imported: Imported;
  try {
    imported = engine.importIcs(text, floatingZone);
  } catch (error: unknown) {
    if (error instanceof CalendarRefusal) return { ok: false, why: NOT_READ[error.code] ?? `the Calendar refused it (${error.code})` };
    throw error;
  }
  const drafts: Draft[] = imported.drafts.filter((d: Draft): boolean => !d.cancelled);
  return { ok: true, drafts, skipped: imported.skipped, cancelled: imported.drafts.length - drafts.length };
}

export interface ImportContext {
  readonly id: () => string;
  readonly node: string;
  readonly me: string;
  readonly nowMs: bigint;
}

export function savingOf(draft: Draft, ctx: ImportContext): Saving {
  const id: string = ctx.id();
  const event: Event = {
    id, rev: 1, origin_node: ctx.node, author: ctx.me, title: draft.title, body: draft.body,
    kind: 'plain', status: 'confirmed', when: draft.when, zone: draft.zone,
    location: draft.location === null ? 'in_app' : { text: { text: draft.location } },
    hosts: [ctx.me], invitees: [], visibility: 'private', propagate: { down: false, up_to: null }, reminders: [],
    notes_doc: null, source: null, created_ms: ctx.nowMs, updated_ms: ctx.nowMs,
  };
  return { ok: true, event, store: { kind: 'user' }, key: `${PRIVATE_PREFIX}${id}` };
}

/** When a draft is, in its own zone, as the review lists it. */
export function whenWords(draft: Draft, engine: Pick<CalendarEngine, 'civilOf'>): string {
  const when: Draft['when'] = draft.when;
  if ('all_day' in when) return when.all_day.days === 1 ? `${formatDayLong(when.all_day.date)}, all day` : `${formatDayLong(when.all_day.date)}, ${when.all_day.days} days`;
  if ('once' in when) {
    const day: string = formatDayLong(engine.civilOf(draft.zone, when.once.start_ms).date);
    return `${day}, ${formatTimeIn(when.once.start_ms, draft.zone)} to ${formatTimeIn(when.once.end_ms, draft.zone)}`;
  }
  return `Repeats, from ${formatDayLong(when.recurring.start.date)}`;
}

/**
 * Saves each draft in order, as the editor saves a private event; stops at the first refusal.
 * Resolves null when every one was saved, else what happened.
 */
export async function importDrafts(ports: CalendarPorts, engine: CalendarEngine, drafts: readonly Draft[], ctx: ImportContext): Promise<string | null> {
  for (const [saved, draft] of drafts.entries()) {
    const outcome: SaveOutcome = await saveEvent(ports, engine, savingOf(draft, ctx), null, (): void => undefined);
    if (outcome.kind === 'refused') return `${saved} of ${drafts.length} were imported; "${draft.title}" was not: ${outcome.reason}.`;
  }
  return null;
}
