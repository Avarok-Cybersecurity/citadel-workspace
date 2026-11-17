import { useEffect } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { useLeaveEndedSession, type LeaveEndedSession } from './use-leave-ended-session';
import { getSelectedUser, type TabUserContext } from '@/lib/tab-context';
import { p2pAutoConnectService } from '@/lib/p2p-auto-connect-service';
import { readAgentReconnectEvent, type AgentReconnectEvent } from '@/types/agent-reconnect';
import {
  handleServerReconnectEvent,
  reconnectingTo,
  type OwnSession,
  type ServerReconnectIO,
} from '@/lib/reconnect/server-reconnect';
import { debugLog } from '@/lib/debug-config';
import { postAuthSetup } from '@/lib/post-auth-setup';
import { supervisedByAgent } from '@/lib/agent-supervisor/supervised';

/**
 * Connects the agent's server-link notifications to this tab (server-reconnect.ts).
 * Inside the router, because giving up sends the user to sign in.
 */
export function ServerReconnectWatcher(): null {
  const leave: LeaveEndedSession = useLeaveEndedSession();

  useEffect(() => {
    const io: ServerReconnectIO = {
      ownSession: async (): Promise<OwnSession | null> => {
        const tab: TabUserContext | null = await getSelectedUser();
        if (!tab?.selectedCid || !tab.selectedUsername || !tab.selectedServerAddress) return null;
        return { cid: tab.selectedCid, username: tab.selectedUsername, server: tab.selectedServerAddress };
      },
      setReconnecting: reconnectingTo.set,
      resumePeers: async (): Promise<void> => {
        // A supervising agent redials the peers it lost itself.
        if (await supervisedByAgent()) return;
        // The drop took every P2P link with it; the reset forgets them and puts
        // this side in initiator mode, as the startup path does after a claim.
        await p2pAutoConnectService.resetConnectionState();
        await p2pAutoConnectService.connectToAllRegisteredPeers();
      },
      // The same sequence sign-in and the start-up claim run, so a page that loaded
      // during the drop ends up exactly where a fresh sign-in would.
      reloadWorkspace: (cid: bigint): Promise<void> => postAuthSetup(cid),
      // The same way out as every other ended session: unsaved editor text is asked about first.
      signInAgain: (path: string, message: string): void => {
        leave(path, message).catch((error: unknown): void => { debugLog('ServerReconnect', 'Leaving failed', error); });
      },
    };

    // One at a time and in arrival order: each first awaits this tab's session,
    // so a "reconnected" handled before its "lost" would leave the banner up.
    let queue: Promise<void> = Promise.resolve();
    const onMessage = (message: unknown): void => {
      const event: AgentReconnectEvent | null = readAgentReconnectEvent(message);
      if (!event) return;
      queue = queue
        .then(() => handleServerReconnectEvent(event, io))
        .catch((error: unknown): void => { debugLog('ServerReconnect', `Handling ${event.kind} failed`, error); });
    };
    eventEmitter.on('websocket-message', onMessage);
    return (): void => {
      eventEmitter.off('websocket-message', onMessage);
      reconnectingTo.set(null);
    };
  }, [leave]);

  return null;
}
