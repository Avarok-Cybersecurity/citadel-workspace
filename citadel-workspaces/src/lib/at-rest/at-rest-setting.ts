/**
 * The account's "Encrypt on this device" setting as the page shows it, one store per account so
 * the title bar's switch and the Settings entry agree. The setting itself is the device record
 * the seam keeps (lib/document-replica-cache.ts), loaded with the first read or change.
 */
import { createValueStore, type ValueStore } from '@/lib/value-store';

export interface AtRestSetting {
  /** null until read. */
  readonly on: boolean | null;
  /** A change is converting the records now. */
  readonly changing: boolean;
}

const stores: Map<bigint, ValueStore<AtRestSetting>> = new Map<bigint, ValueStore<AtRestSetting>>();

export function atRestSetting(account: bigint): ValueStore<AtRestSetting> {
  const known: ValueStore<AtRestSetting> | undefined = stores.get(account);
  if (known) return known;
  const made: ValueStore<AtRestSetting> = createValueStore<AtRestSetting>(`at-rest:${account.toString()}`, { on: null, changing: false });
  stores.set(account, made);
  return made;
}

const seam = (): Promise<typeof import('@/lib/document-replica-cache')> => import('@/lib/document-replica-cache');

export async function readAtRestSetting(account: bigint): Promise<void> {
  const store: ValueStore<AtRestSetting> = atRestSetting(account);
  const on: boolean = await (await seam()).documentsAtRest(account);
  store.set({ on, changing: store.get().changing });
}

/** Turns it on or off; rejects with the reason (AtRestRefusedError) when refused, nothing changed. */
export async function changeAtRestSetting(account: bigint, on: boolean): Promise<void> {
  const store: ValueStore<AtRestSetting> = atRestSetting(account);
  store.set({ on: store.get().on, changing: true });
  try {
    await (await seam()).setDocumentsAtRest(account, on);
  } finally {
    store.set({ on: await (await seam()).documentsAtRest(account), changing: false });
  }
}
