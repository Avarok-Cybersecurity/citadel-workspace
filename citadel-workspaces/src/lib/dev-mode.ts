/**
 * "Dev mode": this device shows internals that mean nothing to someone using the product -- the
 * first of them being whether this tab leads the others or follows (LeaderIndicator).
 *
 * Per device, like the encryption setting it sits beside in storage: one record in the browser's
 * keyValue store, read once and held in a store the page subscribes to, so turning it on shows
 * what it governs at once. Off unless the person turns it on: that is a product decision, stated
 * here (DEV_MODE_DEFAULT) and nowhere else.
 *
 * The rules are pure over a port; lib/dev-mode-device.ts binds the port to the browser's store.
 */
import { createValueStore, type ValueStore } from '@/lib/value-store';

/** Off: internals are for whoever chose to see them. */
export const DEV_MODE_DEFAULT: boolean = false;

/** What this device stored: nothing yet is the default; anything but a boolean is not ours. */
export function readDevMode(stored: unknown): boolean {
  if (stored === undefined) return DEV_MODE_DEFAULT;
  if (typeof stored !== 'boolean') throw new Error('the Dev mode setting on this device is not in the shape this client writes');
  return stored;
}

export interface DevModePort {
  read: () => Promise<unknown>;
  write: (on: boolean) => Promise<void>;
}

export interface DevMode {
  /** null until read. */
  readonly store: ValueStore<boolean | null>;
  /** Reads the device's record, once; later calls answer the same read. */
  readonly load: () => Promise<void>;
  /** Saves the choice, then shows it; rejects with nothing shown changed when the write fails. */
  readonly change: (on: boolean) => Promise<void>;
}

export function createDevMode(port: DevModePort): DevMode {
  const store: ValueStore<boolean | null> = createValueStore<boolean | null>('dev-mode', null);
  let loading: Promise<void> | null = null;
  const load = (): Promise<void> => {
    loading ??= port.read().then((stored: unknown): void => { if (store.get() === null) store.set(readDevMode(stored)); })
      .catch((error: unknown): never => { loading = null; throw error; });
    return loading;
  };
  const change = async (on: boolean): Promise<void> => {
    await port.write(on);
    store.set(on);
  };
  return { store, load, change };
}
