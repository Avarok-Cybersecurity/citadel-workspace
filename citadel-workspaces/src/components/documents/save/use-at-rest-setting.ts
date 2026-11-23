import { useEffect, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { atRestSetting, readAtRestSetting, type AtRestSetting } from '@/lib/at-rest/at-rest-setting';

/** The account's "Encrypt on this device", live from its one store, read once on first use. */
export function useAtRestSetting(account: bigint): AtRestSetting {
  const store: ReturnType<typeof atRestSetting> = atRestSetting(account);
  const setting: AtRestSetting = useSyncExternalStore(store.subscribe, store.get);
  useEffect((): void => {
    readAtRestSetting(account).catch((error: unknown): void => {
      toast.error(`Could not read the encryption setting. ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [account]);
  return setting;
}
