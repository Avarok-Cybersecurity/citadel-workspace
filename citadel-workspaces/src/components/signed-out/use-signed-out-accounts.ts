/**
 * The accounts the agent signed out after a failed reconnect (GetSessions'
 * `signed_out`), read when the caller mounts.
 *
 * The live give-up is announced as it happens (ServerReconnectFailed). This is
 * for the UI that was closed at the time: without it such an account simply
 * vanished from the agent, and nothing said why.
 */
import { useEffect, useState } from 'react';
import { connectionManager } from '@/lib/connection';
import type { ActiveSessionsResult } from '@/lib/connection/queries';
import type { SignedOutAccount } from '@/types/session-types';
import { debugLog } from '@/lib/debug-config';

/** Empty until the agent has answered, and when it could not be asked: a failure is not a sign-out. */
export function useSignedOutAccounts(): SignedOutAccount[] {
  const [accounts, setAccounts] = useState<SignedOutAccount[]>([]);
  useEffect(() => {
    let live: boolean = true;
    const read = async (): Promise<void> => {
      await connectionManager.waitForReady();
      const result: ActiveSessionsResult = await connectionManager.getActiveSessionsResult();
      if (live && result.ok) setAccounts(result.signedOut);
    };
    read().catch((error: unknown): void => { debugLog('SignedOut', 'could not read signed-out accounts', error); });
    return (): void => { live = false; };
  }, []);
  return accounts;
}
