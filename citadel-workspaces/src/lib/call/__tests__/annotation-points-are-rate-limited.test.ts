/**
 * A drawn point went on the wire once per pointer event, per participant.
 *
 * `onPointerMove` fires 120 or more times a second, and `sendAnnotation` emits
 * one signal PER PARTICIPANT for each. A five-person call put six hundred
 * signals a second onto the reliable call-signal chain — the same chain
 * `CallEnd` travels on, so hanging up queued behind somebody's doodle.
 *
 * The receiver joins points into a polyline, so a coarser rate costs a slightly
 * more angular line. Not capping it costs a shared transport nobody else can
 * get onto.
 */
import { describe, it, expect } from 'vitest';
import { admitPoint, newStrokeClock, MIN_POINT_INTERVAL_MS, type StrokeClock } from '../annotation-rate';

describe('admitting a drawn point', () => {
  it('never delays the first point of a stroke', () => {
    // The one a person can see arriving late: the mark that should appear under
    // their finger. It is one signal, not a stream.
    const clock: StrokeClock = newStrokeClock();
    expect(admitPoint(clock, 'stroke-1', 1_000)).toBe(true);
  });

  it('drops the flood between admitted points', () => {
    const clock: StrokeClock = newStrokeClock();
    admitPoint(clock, 'stroke-1', 0);

    // A 120Hz pointer: roughly eight milliseconds apart.
    let admitted: number = 0;
    for (let t: number = 8; t <= MIN_POINT_INTERVAL_MS - 1; t += 8) {
      if (admitPoint(clock, 'stroke-1', t)) admitted += 1;
    }

    expect(admitted, 'every pointer event still reached the wire').toBe(0);
  });

  it('lets the stroke continue once the interval has passed', () => {
    // The opposite failure: a limiter that never admits again would freeze the
    // line after its first point, and the assertion above cannot see it.
    const clock: StrokeClock = newStrokeClock();
    admitPoint(clock, 'stroke-1', 0);

    expect(admitPoint(clock, 'stroke-1', MIN_POINT_INTERVAL_MS)).toBe(true);
    expect(admitPoint(clock, 'stroke-1', MIN_POINT_INTERVAL_MS + 1)).toBe(false);
    expect(admitPoint(clock, 'stroke-1', MIN_POINT_INTERVAL_MS * 2)).toBe(true);
  });

  it('starts a new stroke immediately, however soon it follows', () => {
    // Two quick taps are two strokes, and the second must not be swallowed by
    // the first one's interval.
    const clock: StrokeClock = newStrokeClock();
    admitPoint(clock, 'stroke-1', 0);

    expect(admitPoint(clock, 'stroke-2', 1)).toBe(true);
  });

  it('caps a 120Hz stroke at roughly twenty points a second', () => {
    // The number that matters: what one second of drawing costs the transport,
    // per participant.
    const clock: StrokeClock = newStrokeClock();
    let admitted: number = 0;
    for (let t: number = 0; t < 1_000; t += 8) {
      if (admitPoint(clock, 'stroke-1', t)) admitted += 1;
    }

    expect(admitted).toBeLessThanOrEqual(21);
    expect(admitted, 'the limiter admitted almost nothing, which is not a line').toBeGreaterThan(15);
  });
});

/**
 * And the manager has to consult it.
 *
 * The tests above call `admitPoint` directly, so they pass whether or not
 * `CallManager.annotate` asks — the same wiring blindness that has now come up
 * in five rounds. This drives the manager.
 */
import { vi } from 'vitest';
import { CallManager } from '../call-manager';
import type { CallSignalPayload } from '@/types/p2p-commands';
import { DIRECT_CALL } from '../call-state';

describe('CallManager.annotate', () => {
  it('sends far fewer signals than a pointer produces events', async (): Promise<void> => {
    const sent: CallSignalPayload[] = [];
    let clock: number = 0;

    const manager: CallManager = new CallManager({
      transport: {
        sendSignal: async (_cid: bigint, signal: CallSignalPayload): Promise<void> => {
          sent.push(signal);
        },
        openSession: async (): Promise<void> => undefined,
        closeSession: async (): Promise<void> => undefined,
        sendFrame: (): void => {},
      },
      selfCid: 1n,
      capabilities: { decode: [], encode: [] } as never,
      now: (): number => clock,
      schedule: (): (() => void) => (): void => {},
      onStateChanged: (): void => {},
      onKeyframeRequested: (): void => {},
      resolvePeerName: (): string => 'peer',
    } as never);

    await manager.start('call-1', [{ cid: 2n, username: 'bob' }], { audio: true, video: false, screen: false }, DIRECT_CALL, null);
    sent.length = 0;

    // One second of a 120Hz pointer.
    for (let t: number = 0; t < 1_000; t += 8) {
      clock = t;
      manager.annotate('me', 'stroke-1', { x: t, y: t });
    }

    const annotations: CallSignalPayload[] = sent.filter((s) => s.kind === 'CallAnnotate');
    expect(annotations.length, 'every pointer event reached the transport').toBeLessThanOrEqual(25);
    expect(annotations.length, 'nothing was drawn at all').toBeGreaterThan(0);
  });
});

void vi;
