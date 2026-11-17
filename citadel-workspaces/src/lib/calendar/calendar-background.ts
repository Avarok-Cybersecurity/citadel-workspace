/**
 * The Calendar's work that does not wait for its tab (design §3.7): while any of the member's
 * workspace windows is open, one of them (the holder of the member's runner lock,
 * components/calendar/background) runs this over the Calendar's own ports. It fires the
 * member's reminders on time, raises one notice for those that fell due while no window was open,
 * and tells them of others' changes it hears: an invitation, a cancelled booking, a new poll
 * (invite-notices.ts). Everything it raises goes through `ports.notify`, which the mount has put
 * under the member's notification settings (notice-gate.ts) and the install's grant.
 *
 * With no window open nothing runs: that needs server-side timers (Signals), not this.
 */
import type { StorageChange, Unsubscribe } from '@/lib/citadel-apps/host/glue-instance';
import type { CalendarEngine } from './engine/calendar-engine';
import type { Event } from './generated/Event';
import { formatDayShort, formatTimeIn } from './format';
import { tellAbout } from './invite-notices';
import type { CalendarPorts } from './ports';
import { reminderStore, ReminderRunner } from './reminder-runner';
import type { Due } from './reminder-scheduler';
import { decodeSettings, displayZoneOf, SETTINGS_KEY, type CalendarSettings } from './zones';

/** How long a plan saved in another window can wait to be noticed (reminder-runner.ts `rescanMs`). */
export const RESCAN_MS: number = 60_000;
/** How many missed reminders the notice names before it counts the rest. */
const NAMED: number = 3;

export interface BackgroundDeps {
  readonly ports: CalendarPorts;
  readonly engine: CalendarEngine;
  readonly me: string;
  readonly nodeName: (id: string) => string;
  /** The zone this device shows, for a member who has not chosen one: a notice is read here. */
  readonly deviceZone: string;
  readonly report: (what: string, error: unknown) => void;
}

/** The zone the member reads times in: their choice, else this device's. */
async function zoneOf(d: BackgroundDeps): Promise<string> {
  const bytes: Uint8Array | null = await d.ports.storage.get({ kind: 'user' }, SETTINGS_KEY);
  const settings: CalendarSettings | null = bytes === null ? null : decodeSettings(bytes);
  return settings === null ? d.deviceZone : displayZoneOf(settings.displayZone, d.deviceZone);
}

const startOf = (d: BackgroundDeps, zone: string, ms: bigint): string => `${formatDayShort(d.engine.civilOf(zone, ms).date)}, ${formatTimeIn(ms, zone)}`;

export function missedSummary(late: readonly Due[], describe: (due: Due) => string): string {
  const named: string = late.slice(0, NAMED).map(describe).join('; ');
  return late.length > NAMED ? `${named}; and ${late.length - NAMED} more` : named;
}

/** Starts the work; the returned function stops it. */
export function startCalendarBackground(d: BackgroundDeps): () => void {
  const { ports, engine } = d;
  const runner: ReminderRunner = new ReminderRunner({
    ...reminderStore(ports, engine),
    engine,
    clock: ports.clock,
    isLeader: (): boolean => true,
    rescanMs: RESCAN_MS,
    fire: async (due: Due): Promise<void> => {
      const zone: string = await zoneOf(d);
      await ports.notify('reminders', due.title, `Starts at ${formatTimeIn(due.fire.start_ms, zone)} · ${d.nodeName(due.node)}`);
    },
    missed: async (late: readonly Due[]): Promise<void> => {
      const zone: string = await zoneOf(d);
      const title: string = late.length === 1 ? 'A reminder you missed' : `${late.length} reminders you missed`;
      await ports.notify('reminders', title, missedSummary(late, (due: Due): string => `${due.title} (${startOf(d, zone, due.fire.start_ms)})`));
    },
  });
  runner.tick().catch((e: unknown): void => d.report('[calendar] reminders could not be handled', e));
  // One change at a time, in arrival order, so one change heard twice is told once.
  let turn: Promise<void> = Promise.resolve();
  const off: Unsubscribe = ports.onStorageChanged((change: StorageChange): void => {
    turn = turn.then(async (): Promise<void> => {
      const zone: string = await zoneOf(d);
      await tellAbout(change, { ports, engine, me: d.me, nodeName: d.nodeName, when: (event: Event): string => startOf(d, zone, startMsOf(d, event)) });
    }).catch((e: unknown): void => d.report('[calendar] a change could not be told', e));
  });
  return (): void => {
    runner.stop();
    off();
  };
}

/** The instant an event starts: its first occurrence for a recurring one. */
function startMsOf(d: BackgroundDeps, event: Event): bigint {
  if ('once' in event.when) return event.when.once.start_ms;
  if ('all_day' in event.when) return d.engine.instantOf(event.zone, { date: event.when.all_day.date, minute: 0 });
  return d.engine.instantOf(event.zone, event.when.recurring.start);
}
