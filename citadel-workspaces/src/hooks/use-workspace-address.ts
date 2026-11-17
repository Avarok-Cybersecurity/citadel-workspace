import { useEffect, useState } from 'react';
import { getSelectedUser, type TabUserContext } from '@/lib/tab-context';
import { runAsyncSetup } from '@/lib/utils/async-utils';

/**
 * This tab's workspace address: the connection record's when it has one, else
 * the one this tab's selection names. A resumed tab's connection record can be
 * CID-only -- the invite dialog then offered nothing to send, and a paying
 * owner's "Plan & billing" never appeared.
 *
 * `active` gates the read, so a closed dialog or a non-admin asks nothing.
 */
export function useWorkspaceAddress(active: boolean, connectionAddress: string | undefined): string | undefined {
  const [selected, setSelected] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!active || connectionAddress) return;
    let cancelled: boolean = false;
    runAsyncSetup(async (): Promise<void> => {
      const tab: TabUserContext | null = await getSelectedUser();
      if (!cancelled) setSelected(tab?.selectedServerAddress || undefined);
    });
    return (): void => { cancelled = true; };
  }, [active, connectionAddress]);

  return connectionAddress || selected;
}
