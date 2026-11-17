/**
 * What the event editor decides (design §3.3.2, §3.4): the form checked into an `Event`, and where
 * it is written. A one-off event's wall times are read in the zone the member made it in and kept
 * as instants with that zone (the core resolves a time in a spring-forward gap); an all-day event
 * keeps its civil dates.
 *
 * Where: `private` is the member's own (`storage.user`, `cal/private/<id>`); otherwise the member
 * posts it on the node under their name (`authored`), or, as an editor of the node, makes it one of
 * the node's official events (`node`). Whether they may is the kernel's to decide: a refusal is
 * shown, never pre-empted here. A private event never propagates; only an official one is pushed
 * down, since only the node's editors may write into the pages below.
 */
import { parseClock } from './availability-edit';
import type { CalendarEngine } from './engine/calendar-engine';
import type { CivilDate } from './generated/CivilDate';
import type { Event } from './generated/Event';
import type { Location } from './generated/Location';
import type { Visibility } from './generated/Visibility';
import type { When } from './generated/When';
import type { CalendarStore } from './ports';
import { EVENT_PREFIX, PRIVATE_PREFIX } from './read-sources';

export const MAX_TITLE_CHARS: number = 200;

export type Destination = 'authored' | 'node';

export interface EventDraft {
  title: string;
  notes: string;
  date: CivilDate;
  allDay: boolean;
  start: string;
  end: string;
  location: { kind: 'in_app' } | { kind: 'in_person'; address: string } | { kind: 'text'; text: string };
  visibility: Visibility;
  destination: Destination;
  /** Shown on every page below (design 3.5); only one of the node's own events propagates down. */
  down: boolean;
  /** Also shown on this ancestor and every page between it and here; null for here only. */
  upTo: string | null;
  /** Minutes before the start a reminder fires, each once. */
  reminders: readonly number[];
}

export interface DraftContext {
  readonly id: string;
  readonly node: string;
  readonly me: string;
  /** The zone the member is making it in: their display zone. */
  readonly zone: string;
  readonly nowMs: bigint;
}

export type EventCheck = { ok: true; event: Event; store: CalendarStore; key: string } | { ok: false; errors: ReadonlyMap<string, string> };

function locationOf(draft: EventDraft['location'], errors: Map<string, string>): Location {
  if (draft.kind === 'in_app') return 'in_app';
  const text: string = draft.kind === 'in_person' ? draft.address.trim() : draft.text.trim();
  if (text === '') errors.set('location', draft.kind === 'in_person' ? 'Enter the address.' : 'Enter where it is.');
  return draft.kind === 'in_person' ? { in_person: { address: text } } : { text: { text } };
}

function whenOf(draft: EventDraft, zone: string, engine: Pick<CalendarEngine, 'instantOf'>, errors: Map<string, string>): When {
  if (draft.allDay) return { all_day: { date: draft.date, days: 1 } };
  const start: number | null = parseClock(draft.start);
  const end: number | null = parseClock(draft.end);
  if (start === null || start >= 24 * 60) errors.set('start', 'Enter the start as HH:MM.');
  if (end === null) errors.set('end', 'Enter the end as HH:MM.');
  if (start === null || end === null || start >= 24 * 60) return { once: { start_ms: 0n, end_ms: 0n } };
  const startMs: bigint = engine.instantOf(zone, { date: draft.date, minute: start });
  const endMs: bigint = end === 24 * 60 ? startMs + BigInt((end - start) * 60_000) : engine.instantOf(zone, { date: draft.date, minute: end });
  if (endMs <= startMs) errors.set('end', 'The end must be after the start.');
  return { once: { start_ms: startMs, end_ms: endMs } };
}

export function checkEvent(draft: EventDraft, ctx: DraftContext, engine: Pick<CalendarEngine, 'instantOf'>): EventCheck {
  const errors: Map<string, string> = new Map();
  const title: string = draft.title.trim();
  if (title === '') errors.set('title', 'Give the event a title.');
  else if ([...title].length > MAX_TITLE_CHARS) errors.set('title', `Keep the title under ${MAX_TITLE_CHARS} characters.`);
  const when: When = whenOf(draft, ctx.zone, engine, errors);
  const location: Location = locationOf(draft.location, errors);
  if (errors.size > 0) return { ok: false, errors };
  const event: Event = {
    id: ctx.id, rev: 1, origin_node: ctx.node, author: ctx.me, title, body: draft.notes.trim() === '' ? null : draft.notes.trim(),
    kind: 'plain', status: 'confirmed', when, zone: ctx.zone, location, hosts: [ctx.me], invitees: [], visibility: draft.visibility,
    propagate: draft.visibility === 'private' ? { down: false, up_to: null } : { down: draft.down && draft.destination === 'node', up_to: draft.upTo }, reminders: [...new Set(draft.reminders)].sort((a: number, b: number) => a - b).map((m: number) => ({ minutes_before: m })), notes_doc: null, source: null, created_ms: ctx.nowMs, updated_ms: ctx.nowMs,
  };
  if (draft.visibility === 'private') return { ok: true, event, store: { kind: 'user' }, key: `${PRIVATE_PREFIX}${ctx.id}` };
  const store: CalendarStore = draft.destination === 'node' ? { kind: 'node', node: ctx.node } : { kind: 'authored', node: ctx.node, author: ctx.me };
  return { ok: true, event, store, key: `${EVENT_PREFIX}${ctx.id}` };
}
