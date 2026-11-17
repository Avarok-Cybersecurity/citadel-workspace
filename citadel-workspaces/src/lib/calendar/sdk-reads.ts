/**
 * The SDK's reads (design §3.8), with the member's own rights, as the Calendar's pane reads them:
 * `GET /events` is the node's events the member sees (its own: the node's, what members posted,
 * the member's private ones made there), what ancestors project onto it, or what the pages below
 * pull up; `GET /free-busy` is each named member's busy time on the node. Each event is the core's
 * view of it: never a body, never a cancelled event.
 *
 * A one-off event is returned when it overlaps the range; an all-day or recurring one is returned
 * whole, with its rule, for the app to place.
 */
import { busyOf } from './booking-pages';
import type { CalendarEngine } from './engine/calendar-engine';
import type { EventView } from './generated/EventView';
import type { FreeBusy } from './generated/FreeBusy';
import type { FreeBusyQuery } from './generated/FreeBusyQuery';
import type { ListQuery } from './generated/ListQuery';
import type { CalendarPorts } from './ports';
import { readInherited, readUpPulled } from './read-propagated';
import { readSource, type SourceRead } from './read-sources';
import type { CalendarEntry } from './store';
import { chainOf, descendantsOf } from './tree-walk';

function overlaps(view: EventView, fromMs: bigint, toMs: bigint): boolean {
  if (!('once' in view.when)) return true;
  return view.when.once.start_ms < toMs && fromMs < view.when.once.end_ms;
}

const idOf = (key: string): string => key.slice(key.lastIndexOf('/') + 1);

function viewsOf(entries: readonly CalendarEntry[], engine: CalendarEngine, include: ListQuery['include']): EventView[] {
  const views: EventView[] = [];
  for (const entry of entries) {
    if (entry.source === 'inherited') views.push(engine.sdk.projectionView(idOf(entry.key), entry.projection));
    else {
      const view: EventView | null = engine.sdk.view(entry.event, include);
      if (view !== null) views.push(view);
    }
  }
  return views;
}

async function entriesFor(ports: CalendarPorts, engine: CalendarEngine, q: ListQuery): Promise<CalendarEntry[]> {
  if (q.include === 'inherited') return (await readInherited(ports, engine, q.node)).entries;
  if (q.include === 'up') {
    const [chain, below] = await Promise.all([chainOf(ports, q.node), descendantsOf(ports, q.node, engine.propagationBounds().up_pull)]);
    return (await readUpPulled(ports, engine, chain, below)).entries;
  }
  const read: SourceRead[] = await Promise.all((['node', 'authored', 'private'] as const).map((s) => readSource(ports, engine, s, q.node)));
  return read.flatMap((r) => r.entries).filter((e: CalendarEntry) => e.source === 'inherited' || e.event.origin_node === q.node);
}

export async function listEvents(ports: CalendarPorts, engine: CalendarEngine, q: ListQuery): Promise<EventView[]> {
  const from: bigint = BigInt(q.from_ms);
  const to: bigint = BigInt(q.to_ms);
  return viewsOf(await entriesFor(ports, engine, q), engine, q.include).filter((v: EventView) => overlaps(v, from, to));
}

/**
 * Busy time is a list of instants, so the zone `busyOf` also counts bookings per day in is
 * irrelevant to it: UTC is passed because one must be, and the per-day counts are not used.
 */
const COUNTING_ZONE: string = 'UTC';

export async function freeBusy(ports: CalendarPorts, engine: CalendarEngine, q: FreeBusyQuery): Promise<FreeBusy> {
  const read: [SourceRead, SourceRead] = await Promise.all([readSource(ports, engine, 'node', q.node), readSource(ports, engine, 'authored', q.node)]);
  const entries: CalendarEntry[] = read.flatMap((r) => r.entries);
  const range: { fromMs: bigint; toMs: bigint; } = { fromMs: BigInt(q.from_ms), toMs: BigInt(q.to_ms) };
  return { users: q.users.map((user: string) => ({ user, busy: busyOf(entries, user, COUNTING_ZONE, range, new Set(), engine).busy })) };
}
