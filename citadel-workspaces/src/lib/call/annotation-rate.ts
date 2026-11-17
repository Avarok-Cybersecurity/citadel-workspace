/**
 * How often a drawn point may go on the wire.
 *
 * `onPointerMove` fires per pointer event — 120 or more a second on current
 * hardware, and a pen reports faster still — and `sendAnnotation` emits ONE
 * signal PER PARTICIPANT for each. A five-person call therefore put six hundred
 * signals a second onto the reliable call-signal chain, which is the same chain
 * `CallEnd` travels on. Hanging up queued behind somebody's doodle.
 *
 * A stroke does not need pointer resolution to look like a stroke: the receiver
 * joins the points into a polyline, so the cost of a coarser rate is a very
 * slightly more angular line, and the cost of not capping it is a shared
 * transport nobody else can get onto.
 *
 * The FIRST point of a stroke is never delayed. That is the one a person can
 * see arriving late — the mark that should appear under their finger — and it
 * is one signal, not a stream.
 */

/** ~20 points a second. Fine for a polyline, six times cheaper than 120Hz. */
export const MIN_POINT_INTERVAL_MS: number = 50;

export interface StrokeClock {
  /** The stroke this clock last let through, if any. */
  strokeId: string | null;
  /** When that happened. */
  sentAt: number;
}

export function newStrokeClock(): StrokeClock {
  return { strokeId: null, sentAt: 0 };
}

/**
 * Whether this point should go now, mutating `clock` when it does.
 *
 * Returns true for the first point of any stroke, and thereafter only once the
 * interval has elapsed.
 */
export function admitPoint(clock: StrokeClock, strokeId: string, now: number): boolean {
  if (clock.strokeId !== strokeId) {
    clock.strokeId = strokeId;
    clock.sentAt = now;
    return true;
  }
  if (now - clock.sentAt < MIN_POINT_INTERVAL_MS) return false;
  clock.sentAt = now;
  return true;
}
