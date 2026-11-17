/**
 * Whether a transition dropped frames: the frame probe behind Auto's downgrade.
 *
 * Watches frame-to-frame gaps for `windowMs` and answers true on the first gap
 * over LONG_FRAME_MS. The clock and the frame callback are passed in, so the
 * rule is tested with a scripted clock; the browser's are wired in motion-state.
 */
export const LONG_FRAME_MS: number = 50;

export interface FrameClock {
  now: () => number;
  nextFrame: (callback: (time: number) => void) => void;
}

export function sawLongFrame(clock: FrameClock, windowMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve: (long: boolean) => void): void => {
    const start: number = clock.now();
    let last: number = start;
    const tick = (): void => {
      const now: number = clock.now();
      if (now - last > LONG_FRAME_MS) { resolve(true); return; }
      last = now;
      if (now - start >= windowMs) { resolve(false); return; }
      clock.nextFrame(tick);
    };
    clock.nextFrame(tick);
  });
}
