/**
 * Changing an event after it was saved (design §3.9): which of the entries a reader sees they may
 * edit or cancel, where that entry is stored, the editor's form read back from it, and the revised
 * or cancelled event written over it. A booking is changed through the booking protocol
 * (booking.ts), never here; a projection or an up-pulled event is changed at its origin.
 *
 * Whoever saves a revision passes the stored event as `before` (event-save.ts), so an event that
 * stops propagating, or is cancelled, has its projections below removed.
 */
import type { CalendarEngine } from './engine/calendar-engine';
import type { EventDraft } from './event-draft';
import type { Saving } from './event-save';
import type { Event } from './generated/Event';
import type { CalendarStore } from './ports';
import { EVENT_PREFIX, PRIVATE_PREFIX } from './read-sources';
import type { EventEntry } from './store';
import type { CivilDateTime } from './generated/CivilDateTime';
import type { Visibility } from './generated/Visibility';

type Stored = { readonly store: CalendarStore; readonly key: string };

const sameStore = (a: CalendarStore, b: CalendarStore): boolean =>
  a.kind === b.kind && (a.kind === 'user' || (b.kind !== 'user' && a.node === b.node && (a.kind !== 'authored' || (b.kind === 'authored' && a.author === b.author))));

/** Where `entry`'s event is stored and under which key. */
export function storedAt(entry: EventEntry): Stored {
  const { event } = entry;
  switch (entry.source) {
    case 'node': return { store: { kind: 'node', node: event.origin_node }, key: `${EVENT_PREFIX}${event.id}` };
    case 'authored': return { store: { kind: 'authored', node: event.origin_node, author: event.author }, key: `${EVENT_PREFIX}${event.id}` };
    case 'private': return { store: { kind: 'user' }, key: `${PRIVATE_PREFIX}${event.id}` };
    case 'up_pulled': throw new Error('an up-pulled event is changed at the page it was made on');
  }
}

/**
 * Whether `me` may change `entry` from here: one of the node's own events with `EditMdx` on the
 * node, an event they posted, or their own private event; never a booking, a cancelled event, a
 * recurring one (the editor has no recurrence fields) or one shown here from a page below.
 */
export function changeableBy(entry: EventEntry, me: string, mayEditNode: boolean): boolean {
  const { event } = entry;
  if (event.kind !== 'plain' || event.status !== 'confirmed' || 'recurring' in event.when) return false;
  switch (entry.source) {
    case 'node': return mayEditNode;
    case 'authored': return event.author === me;
    case 'private': return event.author === me;
    case 'up_pulled': return false;
  }
}

const clockOf = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** The editor's form for `event`, its times on `zone`'s clock (the member's display zone). */
export function draftOf(event: Event, zone: string, engine: Pick<CalendarEngine, 'civilOf'>, source: EventEntry['source']): EventDraft {
  const { when } = event;
  if ('recurring' in when) throw new Error('a recurring event is not edited in this form');
  const location: EventDraft['location'] = event.location === 'in_app' ? { kind: 'in_app' }
    : 'in_person' in event.location ? { kind: 'in_person', address: event.location.in_person.address } : { kind: 'text', text: event.location.text.text };
  const base: { title: string; notes: string; location: { kind: "in_app"; } | { kind: "in_person"; address: string; } | { kind: "text"; text: string; }; visibility: Visibility; destination: "node" | "authored"; down: boolean; upTo: string | null; reminders: number[]; } = {
    title: event.title, notes: event.body ?? '', location, visibility: event.visibility,
    destination: source === 'node' ? 'node' as const : 'authored' as const, down: event.propagate.down, upTo: event.propagate.up_to,
    reminders: event.reminders.map((r) => r.minutes_before),
  };
  if ('all_day' in when) return { ...base, date: when.all_day.date, allDay: true, start: '09:00', end: '10:00' };
  const start: CivilDateTime = engine.civilOf(zone, when.once.start_ms);
  const end: CivilDateTime = engine.civilOf(zone, when.once.end_ms);
  const sameDay: boolean = end.date.y === start.date.y && end.date.m === start.date.m && end.date.d === start.date.d;
  return { ...base, date: start.date, allDay: false, start: clockOf(start.minute), end: sameDay ? clockOf(end.minute) : '24:00' };
}

/**
 * `checked` (the form, checked into a fresh event) as the next revision of `before`: the same id,
 * author, hosts and creation time, one revision on, kept where `before` is stored. A form that
 * would move it to another store is refused; the editor never offers that.
 */
export function revise(before: Event, at: Stored, checked: Saving): Saving {
  if (checked.key !== at.key || !sameStore(checked.store, at.store)) throw new Error('an edit would move the event to another store');
  const event: Event = { ...checked.event, id: before.id, author: before.author, hosts: before.hosts, invitees: before.invitees, rev: before.rev + 1, created_ms: before.created_ms };
  return { ok: true, event, store: at.store, key: at.key };
}

/** `before`, cancelled by `by`, one revision on: what a cancel writes over it. */
export function cancelled(before: Event, at: Stored, by: string, reason: string | null, nowMs: bigint): Saving {
  const event: Event = { ...before, status: { cancelled: { by, reason } }, rev: before.rev + 1, updated_ms: nowMs };
  return { ok: true, event, store: at.store, key: at.key };
}
