/**
 * The current day and minute on the display zone's clock, for "today" and the now line: read
 * from the instance's clock and moved on at each minute boundary, so the grid never shows a stale day.
 */
import { useEffect, useState } from 'react';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import type { CivilDateTime } from '@/lib/calendar/generated/CivilDateTime';
import type { DispatchClock } from '@/lib/citadel-apps/host/dispatch';

const MINUTE_MS: number = 60_000;

const civilNow = (engine: CalendarEngine, zone: string, clock: DispatchClock): CivilDateTime =>
  engine.civilOf(zone, BigInt(Math.floor(clock.now())));

export function useMinuteClock(engine: CalendarEngine, zone: string, clock: DispatchClock): CivilDateTime {
  const [now, setNow] = useState<CivilDateTime>((): CivilDateTime => civilNow(engine, zone, clock));
  useEffect(() => {
    const read = (): CivilDateTime => civilNow(engine, zone, clock);
    setNow(read());
    let cancel: () => void = (): void => {};
    const next = (): void => {
      cancel = clock.after(MINUTE_MS - (clock.now() % MINUTE_MS), (): void => {
        setNow(read());
        next();
      });
    };
    next();
    return (): void => cancel();
  }, [engine, zone, clock]);
  return now;
}
