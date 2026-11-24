import { useEffect, useSyncExternalStore } from 'react';
import { devMode } from '@/lib/dev-mode-device';

/** This device's Dev mode: null until read, then live -- a change shows at once, without a reload. */
export function useDevMode(): boolean | null {
  const on: boolean | null = useSyncExternalStore(devMode.store.subscribe, devMode.store.get);
  useEffect((): void => {
    devMode.load().catch((error: unknown): void => { console.error('[dev-mode] the setting on this device could not be read', error); });
  }, []);
  return on;
}
