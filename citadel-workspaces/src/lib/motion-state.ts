/**
 * The motion tier, written onto the document: the one place that does.
 *
 * Two root classes carry it -- REDUCE_MOTION_CLASS for off, LITE_MOTION_CLASS
 * for lite -- and everything else reads them: index.css for CSS motion,
 * useMotionTier for script motion. The OS preference is not folded in here;
 * CSS and useMotionTier each honour it live, so a change of OS setting needs
 * nothing from this module.
 *
 * Auto's downgrade lives here too: a transition seen to drop frames marks the
 * rest of this page's life as lite. Only under Auto -- an explicit Full is
 * what the user asked for -- and only once.
 */
import { appMotionTier, type AnimationsPreference, type DeviceCapabilities, type MotionTier } from './motion-tier';
import { sawLongFrame, type FrameClock } from './long-frames';

export const REDUCE_MOTION_CLASS: 'reduce-motion' = 'reduce-motion';
export const LITE_MOTION_CLASS: 'lite-motion' = 'lite-motion';

let applied: { preference: AnimationsPreference; device: DeviceCapabilities } | null = null;
let slowFramesSeen: boolean = false;

export function applyMotionPreference(preference: AnimationsPreference, device: DeviceCapabilities): void {
  applied = { preference, device };
  const tier: MotionTier = appMotionTier(preference, device, slowFramesSeen);
  const root: HTMLElement = document.documentElement;
  root.classList.toggle(REDUCE_MOTION_CLASS, tier === 'off');
  root.classList.toggle(LITE_MOTION_CLASS, tier === 'lite');
}

/** The tier the document carries, OS aside. */
export function documentMotionTier(): MotionTier {
  const classes: DOMTokenList = document.documentElement.classList;
  if (classes.contains(REDUCE_MOTION_CLASS)) return 'off';
  return classes.contains(LITE_MOTION_CLASS) ? 'lite' : 'full';
}

/** The browser's frame clock, for probeTransition. */
export const BROWSER_FRAMES: FrameClock = {
  now: (): number => performance.now(),
  nextFrame: (callback: (time: number) => void): void => { requestAnimationFrame(callback); },
};

/**
 * Watch the transition that starts now; if it drops a frame under Auto, the rest of this page runs lite.
 * Applied when the watch ends, not mid-transition: the move already under way finishes as it began.
 */
export async function probeTransition(clock: FrameClock, windowMs: number): Promise<void> {
  if (applied?.preference !== 'auto' || slowFramesSeen || documentMotionTier() !== 'full') return;
  if (!(await sawLongFrame(clock, windowMs))) return;
  slowFramesSeen = true;
  applyMotionPreference(applied.preference, applied.device);
}

