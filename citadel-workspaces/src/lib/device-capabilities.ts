/**
 * What the browser reports about the device, for motion-tier.ts. Each field is
 * non-standard somewhere (`deviceMemory` and `connection` are Chromium-only),
 * so an absent one is null, not a guess.
 */
import type { DeviceCapabilities } from './motion-tier';

/** The parts of `navigator` read here, so a test can hand in its own. */
export interface DeviceNavigator {
  readonly deviceMemory?: number;
  readonly hardwareConcurrency?: number;
  readonly connection?: { readonly saveData?: boolean };
}

const finite = (value: number | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

export function readDeviceCapabilities(nav: DeviceNavigator): DeviceCapabilities {
  return {
    deviceMemoryGb: finite(nav.deviceMemory),
    logicalCores: finite(nav.hardwareConcurrency),
    saveData: nav.connection?.saveData === true,
  };
}
