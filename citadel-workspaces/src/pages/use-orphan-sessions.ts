import { useEffect, useState } from 'react';
import { ConnectionManager } from '@/lib/connection';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import { debugLog } from '@/lib/debug-config';
import type { ActiveSession } from '@/types/session-types';

/** Whether the agent holds sessions this browser can resume. Detects only: the navbar lets the user choose. */
export function useHasOrphanSessions(): boolean {
  const [hasOrphanSessions, setHasOrphanSessions] = useState(false);

  useEffect(() => {
    const checkOrphanSessions = async (): Promise<void> => {
      try {
        // Get the connection manager instance
        const connectionManager: ConnectionManager = ConnectionManager.getInstance();

        // Wait for connection manager to be ready before getting sessions
        // This prevents race conditions during component initialization
        await connectionManager.waitForReady();

        // Get active sessions from internal service
        const activeSessions: ActiveSession[] = await connectionManager.getActiveSessions();

        if (activeSessions && activeSessions.length > 0) {
          debugLog('Landing', 'Landing: Found orphan sessions:', activeSessions.length);
          setHasOrphanSessions(true);
          // Note: Don't auto-navigate - let user choose from the navbar
        } else {
          debugLog('Landing', 'Landing: No orphan sessions found');
          setHasOrphanSessions(false);
        }
      } catch (error) {
        debugLog('Landing', 'Landing: Error checking orphan sessions:', error);
        setHasOrphanSessions(false);
      }
    };

    runAsyncSetup(checkOrphanSessions);
  }, []);

  return hasOrphanSessions;
}
