/**
 * The times a booking page offers and, for a team's type, who takes one (design §3.6.1, §3.6.2).
 * Each host's free slots are the core's, from the type's own rules over that host's schedule on
 * the node and what they are busy with (slot-list.ts). A round robin offers a time while any host
 * has it free; a collective only the times every host has free (the core's `collective_slots`).
 * Who takes a round-robin time is the core's `rank_hosts` over the hosts free then, counting each
 * host's confirmed bookings in the strategy's period, the core's `equal_period`: the calendar month
 * the time falls in, in the type's locked zone or else UTC, whoever is booking and wherever.
 */
import type { HostBusy } from './booking-pages';
import type { CalendarEngine } from './engine/calendar-engine';
import type { Availability } from './generated/Availability';
import type { CivilDate } from './generated/CivilDate';
import type { Event } from './generated/Event';
import type { EventType } from './generated/EventType';
import type { HostCount } from './generated/HostCount';
import type { Interval } from './generated/Interval';
import type { SlotRequest } from './generated/SlotRequest';
import { slotRequest } from './slot-list';
import type { CalendarEntry } from './store';
import { teamHosts } from './team-types';

export interface SlotAsk {
  readonly type: EventType;
  readonly durationMin: number;
  readonly nowMs: bigint;
  readonly from: CivilDate;
  readonly to: CivilDate;
}

/** What a host's slots are computed from: their schedule on the node (null: none saved) and their busy times. */
export type HostSource = (host: string) => { availability: Availability | null; busyFor: (fromMs: bigint, toMs: bigint, zone: string) => HostBusy };

type Engine = Pick<CalendarEngine, 'instantOf' | 'addDays' | 'freeSlots' | 'collectiveSlots'>;

/** The core's question for `ask` over one host's schedule and what they are busy with across its days. */
export function askRequest(engine: Pick<CalendarEngine, 'instantOf' | 'addDays'>, ask: SlotAsk, availability: Availability, busyFor: (fromMs: bigint, toMs: bigint, zone: string) => HostBusy): SlotRequest {
  const fromMs: bigint = engine.instantOf(availability.zone, { date: ask.from, minute: 0 });
  const toMs: bigint = engine.instantOf(availability.zone, { date: engine.addDays(ask.to, 1), minute: 0 });
  const { busy, booked } = busyFor(fromMs, toMs, availability.zone);
  return slotRequest({ type: ask.type, durationMin: ask.durationMin, availability, busy, booked, nowMs: ask.nowMs, from: ask.from, to: ask.to });
}

/** One host's free slots for `ask`; none while they have no schedule. A refusal of the core is thrown. */
export function hostSlots(engine: Engine, ask: SlotAsk, availability: Availability | null, busyFor: (fromMs: bigint, toMs: bigint, zone: string) => HostBusy): Interval[] {
  return availability === null ? [] : engine.freeSlots(askRequest(engine, ask, availability, busyFor));
}

const slotKey = (s: Interval): string => `${s.start_ms}-${s.end_ms}`;
const byStart = (a: Interval, b: Interval): number => (a.start_ms < b.start_ms ? -1 : a.start_ms > b.start_ms ? 1 : a.end_ms < b.end_ms ? -1 : a.end_ms > b.end_ms ? 1 : 0);

export interface TeamSlots {
  readonly slots: Interval[];
  /** Per slot (`start-end`), the hosts free then, in the type's order. */
  readonly freeHosts: ReadonlyMap<string, readonly string[]>;
}

/** The times a team's type offers, and who is free at each. */
export function teamSlots(engine: Engine, ask: SlotAsk, source: HostSource): TeamSlots {
  const hosts: string[] | null = teamHosts(ask.type);
  if (hosts === null) throw new Error(`${ask.type.name} is not a team type`);
  const perHost: Interval[][] = hosts.map((h: string) => {
    const { availability, busyFor } = source(h);
    return [...hostSlots(engine, ask, availability, busyFor)].sort(byStart);
  });
  const freeHosts: Map<string, string[]> = new Map();
  perHost.forEach((slots: Interval[], i: number): void => {
    for (const s of slots) freeHosts.set(slotKey(s), [...(freeHosts.get(slotKey(s)) ?? []), hosts[i] as string]);
  });
  const isCollective: boolean = typeof ask.type.kind === 'object' && 'collective' in ask.type.kind;
  const offered: Interval[] = isCollective ? engine.collectiveSlots(perHost) : dedupe(perHost.flat().sort(byStart));
  return { slots: offered, freeHosts };
}

function dedupe(sorted: Interval[]): Interval[] {
  return sorted.filter((s: Interval, i: number): boolean => i === 0 || slotKey(s) !== slotKey(sorted[i - 1] as Interval));
}

export const freeAt = (team: TeamSlots, slot: Interval): readonly string[] => team.freeHosts.get(slotKey(slot)) ?? [];

/** Each host's confirmed bookings starting in `[fromMs, toMs)` among the entries read. */
export function confirmedCounts(entries: Iterable<CalendarEntry>, hosts: readonly string[], fromMs: bigint, toMs: bigint): HostCount[] {
  const counts: Map<string, number> = new Map(hosts.map((h: string) => [h, 0]));
  const seen: Set<string> = new Set();
  for (const entry of entries) {
    if (entry.source === 'inherited') continue;
    const e: Event = entry.event;
    if (seen.has(e.id) || e.status !== 'confirmed' || typeof e.kind !== 'object' || !('once' in e.when)) continue;
    const start: bigint = e.when.once.start_ms;
    if (start < fromMs || start >= toMs) continue;
    seen.add(e.id);
    for (const h of e.hosts) if (counts.has(h)) counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  return hosts.map((host: string) => ({ host, confirmed: counts.get(host) ?? 0 }));
}

/** The hosts free at `slot`, in the order a round-robin booking tries them. */
export function rankedFor(engine: Pick<CalendarEngine, 'rankHosts' | 'equalPeriod'>, type: EventType, slot: Interval, free: readonly string[], entries: Iterable<CalendarEntry>): string[] {
  if (typeof type.kind !== 'object' || !('round_robin' in type.kind)) throw new Error(`${type.name} is not a round robin`);
  const { hosts, strategy } = type.kind.round_robin;
  const period: Interval = engine.equalPeriod(type.zone_lock, slot.start_ms);
  return engine.rankHosts(strategy, hosts, [...free], confirmedCounts(entries, hosts, period.start_ms, period.end_ms));
}
