import { useEffect, useState } from 'react';
import { debugLog } from '@/lib/debug-config';

/** How long workspace data may take to arrive before the loader says so. */
const WORKSPACE_DATA_TIMEOUT_MS: number = 10_000;

/**
 * True once a tab has a connection but the workspace data has still not arrived.
 *
 * The two conditions are separate on purpose: "cannot connect" and "connected
 * but nothing came back" are different problems with different advice, and a
 * single spinner for both left the second one indistinguishable from a slow
 * network. A follower tab that cannot own the WASM client is the case that
 * motivated it.
 */
export function useWorkspaceDataTimeout(
  hasConnection: boolean | null,
  isLoading: boolean,
  isDevMode: boolean,
): boolean {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (isDevMode || !hasConnection || !isLoading) {
      setTimedOut(false);
      return;
    }
    const timer: NodeJS.Timeout = setTimeout((): void => {
      debugLog('WorkspaceLoader', 'Workspace data loading timeout — connection exists but data never arrived');
      setTimedOut(true);
    }, WORKSPACE_DATA_TIMEOUT_MS);
    return (): void => clearTimeout(timer);
  }, [hasConnection, isLoading, isDevMode]);

  return timedOut;
}
