/**
 * On a slower device Auto chooses lighter motion by itself (owner, 2026-10-16: "on slower devices,
 * automatically switch to something less heavy").
 *
 * Real: the selection rule, the capability reader over a navigator-shaped object, the frame probe
 * over a scripted clock, and the document's classes. Nothing is mocked: each fact is handed in.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { appMotionTier, deviceIsSlow, motionTier, type DeviceCapabilities, type MotionTier } from '../motion-tier';
import { readDeviceCapabilities } from '../device-capabilities';
import { sawLongFrame, type FrameClock } from '../long-frames';

const BIG: DeviceCapabilities = { deviceMemoryGb: 16, logicalCores: 12, saveData: false };
const UNKNOWN: DeviceCapabilities = { deviceMemoryGb: null, logicalCores: null, saveData: false };

describe('Auto', () => {
  it('is full on a device that keeps up, and on one that says nothing about itself', () => {
    expect(appMotionTier('auto', BIG, false)).toBe('full');
    expect(appMotionTier('auto', UNKNOWN, false)).toBe('full');
  });

  it('is lite at 4 GB or less, 4 cores or fewer, or with Save-Data on', () => {
    for (const device of [{ ...BIG, deviceMemoryGb: 4 }, { ...BIG, deviceMemoryGb: 2 }, { ...BIG, logicalCores: 4 }, { ...BIG, saveData: true }]) {
      expect(appMotionTier('auto', device, false), JSON.stringify(device)).toBe('lite');
    }
    // The discrimination: just above both limits is not slow.
    expect(deviceIsSlow({ deviceMemoryGb: 8, logicalCores: 5, saveData: false })).toBe(false);
  });

  it('is lite once a transition has dropped frames', () => {
    expect(appMotionTier('auto', BIG, true)).toBe('lite');
  });
});

describe('an explicit choice', () => {
  it('is what the user chose, whatever the device or the frames', () => {
    for (const chosen of ['full', 'lite', 'off'] as const) {
      expect(appMotionTier(chosen, { deviceMemoryGb: 1, logicalCores: 1, saveData: true }, true)).toBe(chosen);
      expect(appMotionTier(chosen, BIG, false)).toBe(chosen);
    }
  });

  it('gives way to the OS asking for reduced motion', () => {
    for (const tier of ['full', 'lite', 'off'] as const) expect(motionTier(tier, true)).toBe('off');
    expect((['full', 'lite', 'off'] as MotionTier[]).map((t: MotionTier) => motionTier(t, false))).toEqual(['full', 'lite', 'off']);
  });
});

describe('what the browser reports', () => {
  it('is read as given, and what it does not report is unknown rather than guessed', () => {
    expect(readDeviceCapabilities({ deviceMemory: 4, hardwareConcurrency: 8, connection: { saveData: true } })).toEqual({ deviceMemoryGb: 4, logicalCores: 8, saveData: true });
    expect(readDeviceCapabilities({})).toEqual(UNKNOWN);
    expect(readDeviceCapabilities({ deviceMemory: Number.NaN, hardwareConcurrency: 0 })).toEqual(UNKNOWN);
  });
});

/** A clock whose frames arrive at the given gaps. */
function framesAt(gaps: number[]): FrameClock {
  let time: number = 0;
  const pending: Array<(t: number) => void> = [];
  const clock: FrameClock = { now: (): number => time, nextFrame: (cb: (t: number) => void): void => { pending.push(cb); } };
  queueMicrotask(function run(): void {
    const cb: ((t: number) => void) | undefined = pending.shift();
    if (cb === undefined) return;
    time += gaps.shift() ?? 16;
    cb(time);
    queueMicrotask(run);
  });
  return clock;
}

describe('the frame probe', () => {
  it('sees a frame longer than 50ms during the window', async () => {
    expect(await sawLongFrame(framesAt([16, 17, 70, 16]), 300)).toBe(true);
  });

  it('does not see one that is not there, nor one after the window', async () => {
    expect(await sawLongFrame(framesAt([16, 17, 50, 16, 16]), 80)).toBe(false);
    expect(await sawLongFrame(framesAt([16, 16, 16, 16, 16, 16, 90]), 80)).toBe(false);
  });
});

describe('a page under Auto that drops frames', () => {
  beforeEach(() => { vi.resetModules(); document.documentElement.className = ''; });

  it('runs lite from then on, and only under Auto', async () => {
    const state: typeof import('../motion-state') = await import('../motion-state');
    state.applyMotionPreference('auto', BIG);
    expect(state.documentMotionTier()).toBe('full');
    await state.probeTransition(framesAt([16, 90]), 300);
    expect(state.documentMotionTier()).toBe('lite');
    // Still lite after the setting is re-applied (Settings open, a reload of the tab's state).
    state.applyMotionPreference('auto', BIG);
    expect(state.documentMotionTier()).toBe('lite');

    vi.resetModules();
    const fresh: typeof import('../motion-state') = await import('../motion-state');
    fresh.applyMotionPreference('full', BIG);
    await fresh.probeTransition(framesAt([16, 90]), 300);
    expect(fresh.documentMotionTier()).toBe('full');
    // Nor was the drop noted against Auto: Full is not watched at all.
    fresh.applyMotionPreference('auto', BIG);
    expect(fresh.documentMotionTier()).toBe('full');
  });

  it('stays full when the transition kept up', async () => {
    const state: typeof import('../motion-state') = await import('../motion-state');
    state.applyMotionPreference('auto', BIG);
    await state.probeTransition(framesAt([16, 16, 17, 16]), 60);
    expect(state.documentMotionTier()).toBe('full');
  });
});
