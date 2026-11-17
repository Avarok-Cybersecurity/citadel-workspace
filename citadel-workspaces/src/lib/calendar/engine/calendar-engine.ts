/**
 * The Calendar's core in the page, typed (Calendar design 3.2). The glue's exports take and give
 * untyped values; this is the one place they get the core's generated types, and the one place a
 * refusal the core throws becomes a `CalendarRefusal`. The store and the views use this, never
 * the glue.
 */
import type { Availability } from '../generated/Availability';
import type { Booking } from '../generated/Booking';
import type { ReminderPlan } from '../generated/ReminderPlan';
import type { CalChange } from '../generated/CalChange';
import type { CivilDate } from '../generated/CivilDate';
import type { CivilDateTime } from '../generated/CivilDateTime';
import type { Event } from '../generated/Event';
import type { EventType } from '../generated/EventType';
import type { Expansion } from '../generated/Expansion';
import type { HostCount } from '../generated/HostCount';
import type { IcsFile } from '../generated/IcsFile';
import type { Imported } from '../generated/Imported';
import type { Interval } from '../generated/Interval';
import type { OriginRead } from '../generated/OriginRead';
import type { Projection } from '../generated/Projection';
import type { PropagationBounds } from '../generated/PropagationBounds';
import type { Reconciled } from '../generated/Reconciled';
import type { Recurrence } from '../generated/Recurrence';
import type { Resolution } from '../generated/Resolution';
import type { SlotRequest } from '../generated/SlotRequest';
import type { Strategy } from '../generated/Strategy';
import type { UpPull } from '../generated/UpPull';
import type { Weekday } from '../generated/Weekday';
import type { Write } from '../generated/Write';
import type { CalendarGlue } from './load-calendar-wasm';
import { call } from './call';
import type { OffsetAt } from './intl-offsets';
import { SdkEngine } from './sdk-engine';
import { TeamEngine } from './team-engine';

export { CalendarRefusal } from './call';

export class CalendarEngine {
  private readonly glue: CalendarGlue;
  private readonly zoned: InstanceType<CalendarGlue['CalendarEngine']>;
  /** Team bookings, polls and routing forms (design §3.6.2, §3.6.3). */
  readonly team: TeamEngine;
  /** The Calendar SDK's wire and decisions (design §3.8). */
  readonly sdk: SdkEngine;

  /** Over an initialised glue and the page's time-zone database. */
  constructor(glue: CalendarGlue, offsetAt: OffsetAt) {
    this.glue = glue;
    this.zoned = new glue.CalendarEngine(offsetAt);
    this.team = new TeamEngine(glue);
    this.sdk = new SdkEngine(glue);
  }

  resolve(zone: string, local: CivilDateTime): Resolution {
    return call((): unknown => this.zoned.resolve(zone, local));
  }
  instantOf(zone: string, local: CivilDateTime): bigint {
    return call((): unknown => this.zoned.instantOf(zone, local));
  }
  civilOf(zone: string, utcMs: bigint): CivilDateTime {
    return call((): unknown => this.zoned.civilOf(zone, utcMs));
  }
  expand(recurrence: Recurrence, zone: string, fromMs: bigint, toMs: bigint): Expansion {
    return call((): unknown => this.zoned.expand(recurrence, zone, fromMs, toMs));
  }
  freeSlots(request: SlotRequest): Interval[] {
    return call((): unknown => this.zoned.freeSlots(request));
  }
  offers(request: SlotRequest, slot: Interval): boolean {
    return call((): unknown => this.zoned.offers(request, slot));
  }
  /** The span `Equal` counts each host's bookings over for a slot at `atMs`: the calendar month in `zoneLock`, or in UTC (the core's `equal_period`). */
  equalPeriod(zoneLock: string | null, atMs: bigint): Interval {
    return call((): unknown => this.zoned.equalPeriod(zoneLock, atMs));
  }
  importIcs(text: string, floatingZone: string): Imported {
    return call((): unknown => this.zoned.importIcs(text, floatingZone));
  }
  addDays(date: CivilDate, days: number): CivilDate {
    return call((): unknown => this.glue.addDays(date, days));
  }
  /** The day clamped to the target month's length. */
  addMonths(date: CivilDate, months: number): CivilDate {
    return call((): unknown => this.glue.addMonths(date, months));
  }
  /** Monday to Sunday. */
  weekOf(date: CivilDate): CivilDate[] {
    return call((): unknown => this.glue.weekOf(date));
  }
  /** Whole Monday-first weeks from the week of the 1st to the week of the last day. */
  monthGrid(year: number, month: number): CivilDate[] {
    return call((): unknown => this.glue.monthGrid(year, month));
  }
  weekdayOf(date: CivilDate): Weekday {
    return call((): unknown => this.glue.weekdayOf(date));
  }
  rankHosts(strategy: Strategy, hosts: string[], free: string[], confirmed: HostCount[]): string[] {
    return call((): unknown => this.glue.rankHosts(strategy, hosts, free, confirmed));
  }
  collectiveSlots(perHost: Interval[][]): Interval[] {
    return call((): unknown => this.glue.collectiveSlots(perHost));
  }
  fanOutPlan(event: Event, subtree: string[]): Write[] {
    return call((): unknown => this.glue.fanOutPlan(event, subtree));
  }
  shownUpAt(event: Event, readerChain: string[]): boolean {
    return call((): unknown => this.glue.shownUpAt(event, readerChain));
  }
  upPullTargets(descendants: string[]): UpPull {
    return call((): unknown => this.glue.upPullTargets(descendants));
  }
  /** What a descendant holds of `event`, by the core's allow-list. */
  project(event: Event): Projection {
    return call((): unknown => this.glue.project(event));
  }
  propagationBounds(): PropagationBounds {
    return call((): unknown => this.glue.propagationBounds());
  }
  reconcile(projection: Projection, origin: OriginRead): Reconciled {
    return call((): unknown => this.glue.reconcile(projection, origin));
  }
  exportIcs(events: Event[]): IcsFile {
    return call((): unknown => this.glue.exportIcs(events));
  }
  encodeEvent(event: Event): Uint8Array {
    return call((): unknown => this.glue.encodeEvent(event));
  }
  decodeEvent(bytes: Uint8Array): Event {
    return call((): unknown => this.glue.decodeEvent(bytes));
  }
  encodeAvailability(value: Availability): Uint8Array {
    return call((): unknown => this.glue.encodeAvailability(value));
  }
  decodeAvailability(bytes: Uint8Array): Availability {
    return call((): unknown => this.glue.decodeAvailability(bytes));
  }
  encodeEventType(value: EventType): Uint8Array {
    return call((): unknown => this.glue.encodeEventType(value));
  }
  decodeEventType(bytes: Uint8Array): EventType {
    return call((): unknown => this.glue.decodeEventType(bytes));
  }
  encodeBooking(value: Booking): Uint8Array {
    return call((): unknown => this.glue.encodeBooking(value));
  }
  decodeBooking(bytes: Uint8Array): Booking {
    return call((): unknown => this.glue.decodeBooking(bytes));
  }
  encodeProjection(value: Projection): Uint8Array {
    return call((): unknown => this.glue.encodeProjection(value));
  }
  decodeProjection(bytes: Uint8Array): Projection {
    return call((): unknown => this.glue.decodeProjection(bytes));
  }
  encodeReminderPlan(value: ReminderPlan): Uint8Array {
    return call((): unknown => this.glue.encodeReminderPlan(value));
  }
  decodeReminderPlan(bytes: Uint8Array): ReminderPlan {
    return call((): unknown => this.glue.decodeReminderPlan(bytes));
  }
  encodeChange(change: CalChange): Uint8Array {
    return call((): unknown => this.glue.encodeChange(change));
  }
  decodeChange(bytes: Uint8Array): CalChange {
    return call((): unknown => this.glue.decodeChange(bytes));
  }
}
