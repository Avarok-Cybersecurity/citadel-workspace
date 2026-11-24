/**
 * Dev mode as this browser keeps it: the device's keyValue store, the one every per-device record
 * of the page lives in (the encryption setting beside it, the documents it protects). Not per
 * account: a device that shows internals shows them whoever signs in on it.
 */
import { dbGet, dbPut } from '@/lib/storage-utils';
import { createDevMode, type DevMode } from '@/lib/dev-mode';

const KEY: string = 'device:dev-mode';

export const devMode: DevMode = createDevMode({
  read: (): Promise<unknown> => dbGet<unknown>('keyValue', KEY),
  write: (on: boolean): Promise<void> => dbPut('keyValue', KEY, on),
});
