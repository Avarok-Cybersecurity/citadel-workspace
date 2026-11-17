/**
 * The clock the Calendar scenarios hand their glue instance, so what they place relative to "now"
 * lands on the same day whatever time the harness runs: it reads PINNED_MS at page load and moves
 * on with real elapsed time, so timers, rate buckets and stream deadlines still advance.
 * 15:00 UTC is 11:00 in New York, 10:00 in Chicago: hours from every day boundary either side.
 */
export const PINNED_MS = Date.UTC(2024, 6, 16, 15, 0);

export function pinnedClock(at = PINNED_MS) {
  const start = performance.now();
  return {
    now: () => at + (performance.now() - start),
    after: (ms, fire) => { const id = setTimeout(fire, ms); return () => clearTimeout(id); },
  };
}

/** The hour after the pinned one, as a BigInt instant: where scenarios start "the coming hour". */
export const nextHour = (clock) => BigInt(Math.ceil(clock.now() / 3_600_000) * 3_600_000);
