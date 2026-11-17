/**
 * How much the app moves: the one decision, made from what is known, with no I/O.
 *
 * `full` is every glide (the focused sidebar's FLIP, its curtains, the tree's
 * height); `lite` keeps only opacity cross-fades; `off` is still. The user
 * chooses in Settings › Appearance; Auto -- the default -- chooses for them
 * (owner, 2026-10-16: "on slower devices, automatically switch to something
 * less heavy"): lite on a device that says it is small (memory or cores at or
 * under four, or Save-Data on), or once a transition has been seen to drop
 * frames this session, else full. An OS request for reduced motion is off,
 * whatever was chosen.
 *
 * The facts are read elsewhere (device-capabilities.ts, long-frames.ts) and
 * passed in, so every rule here is a plain function of its arguments.
 */
export type MotionTier = 'full' | 'lite' | 'off';
export type AnimationsPreference = 'auto' | MotionTier;
export const ANIMATIONS_PREFERENCES: readonly AnimationsPreference[] = ['auto', 'full', 'lite', 'off'];

/** What the browser says about the device; null where it does not say. */
export interface DeviceCapabilities {
  deviceMemoryGb: number | null;
  logicalCores: number | null;
  saveData: boolean;
}

/** At or under these, a device is treated as slow. A field the browser does not report counts for nothing. */
export const SLOW_AT_MOST: { readonly deviceMemoryGb: number; readonly logicalCores: number } = { deviceMemoryGb: 4, logicalCores: 4 };

export function isAnimationsPreference(value: unknown): value is AnimationsPreference {
  return ANIMATIONS_PREFERENCES.some((p: AnimationsPreference): boolean => p === value);
}

export function deviceIsSlow(device: DeviceCapabilities): boolean {
  return device.saveData
    || (device.deviceMemoryGb !== null && device.deviceMemoryGb <= SLOW_AT_MOST.deviceMemoryGb)
    || (device.logicalCores !== null && device.logicalCores <= SLOW_AT_MOST.logicalCores);
}

/** The app's own choice, before the OS has its say: what the document is marked with. */
export function appMotionTier(preference: AnimationsPreference, device: DeviceCapabilities, slowFramesSeen: boolean): MotionTier {
  if (preference !== 'auto') return preference;
  return deviceIsSlow(device) || slowFramesSeen ? 'lite' : 'full';
}

/** What actually runs: the OS asking for reduced motion stops it, whatever the app chose. */
export function motionTier(appTier: MotionTier, osReducesMotion: boolean): MotionTier {
  return osReducesMotion ? 'off' : appTier;
}
