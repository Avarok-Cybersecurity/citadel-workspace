/**
 * TEST RIG: one window's own-store wiring, as host-ports.ts and glue-steps.ts bind it: the
 * install's storage announcing writes to the member's own stores (own-store-writes.ts), and the
 * listen a glue instance's `storageChanges` merges in. The channel posts nowhere: no other window
 * is open. Used by rigs and harness scenarios that mount one Calendar over an in-memory store.
 */
import type { StorageChange, Unsubscribe } from '../../host/glue-instance';
import type { StoragePort } from '../../host/ports';
import { announcingStorage, ownWrites, type OwnWrites } from '../own-store-writes';

export interface OneWindow {
  readonly storage: StoragePort;
  /** The member's own-store writes this window's instances of the install hear. */
  readonly ownChanges: (listener: (change: StorageChange) => void) => Unsubscribe;
}

const RIG_INSTALL: string = 'rig-install';
const RIG_MEMBER: bigint = 1n;

export function oneWindow(port: StoragePort): OneWindow {
  const own: OwnWrites = ownWrites(RIG_MEMBER, () => ({ postMessage: (): void => {}, onMessage: (): void => {} }));
  return {
    storage: announcingStorage(port, RIG_INSTALL, own),
    ownChanges: (listener: (change: StorageChange) => void): Unsubscribe => own.listen(RIG_INSTALL, listener),
  };
}
