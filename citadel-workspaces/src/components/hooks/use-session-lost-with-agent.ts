import { useEffect } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { connectionManager } from '@/lib/connection';
import { getCurrentCid } from '@/lib/p2p/current-cid';
import { watchForSessionLostWithAgent } from '@/lib/connection/sessions-lost-with-agent';
import type { ToastOptions } from '@/hooks/use-toast';
import type { AgentSocketState } from '@/lib/multi-instance/agent-socket-state';

/** Long enough for an automatic sign-in with saved credentials to land first. */
const SESSION_LOST_GRACE_MS: number = 5000;

/**
 * Tell the user when the agent came back without their session, and offer the
 * way forward: signing in again. See sessions-lost-with-agent.ts.
 */
export function useSessionLostWithAgent(toast: (options: ToastOptions) => unknown): void {
  useEffect(() => watchForSessionLostWithAgent({
    onAgentSocket: (handler) => eventEmitter.on<AgentSocketState>('agent-socket-state', handler),
    currentCid: getCurrentCid,
    activeSessions: () => {
      connectionManager.invalidateSessionCache();
      return connectionManager.getActiveSessionsResult();
    },
    wait: (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }),
    notifySessionLost: () => {
      toast({
        id: 'session-lost-with-agent',
        title: 'Signed out',
        description: 'The Citadel agent on this machine restarted, which ended your session. Sign in again to continue.',
        variant: 'destructive',
        duration: Infinity,
        // A full load, not a route change: every service in this tab still
        // holds state for the session that no longer exists.
        action: { label: 'Sign in', onClick: () => { window.location.assign('/'); } },
      });
    },
  }, SESSION_LOST_GRACE_MS), [toast]);
}
