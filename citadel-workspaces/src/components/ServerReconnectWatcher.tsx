import { useEffect } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { toast } from '@/hooks/use-toast';
import { readResumeExpired, resumeExpiredNotice, type ResumeExpired, type ResumeExpiredNotice } from '@/lib/resume/expiry-notice';
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
import { linkOutage } from '@/lib/reconnect/link-outage';
import { debugLog } from '@/lib/debug-config';
import { postAuthSetup } from '@/lib/post-auth-setup';
import { supervisedByAgent } from '@/lib/agent-supervisor/supervised';

/**
 * Connects the agent's server-link notifications to this tab (server-reconnect.ts).
 * Inside the router, because giving up sends the user to sign in.
 */
export function ServerReconnectWatcher(): null {
  const leave: LeaveEndedSession = useLeaveEndedSession();
  const navigate: NavigateFunction = useNavigate();

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
      outage: linkOutage,
    };

    // One at a time and in arrival order: each first awaits this tab's session,
    // so a "reconnected" handled before its "lost" would leave the banner up.
    let queue: Promise<void> = Promise.resolve();
    const onMessage = (message: unknown): void => {
      const expired: ResumeExpired | null = readResumeExpired(message);
      if (expired) {
        queue = queue
          .then(async (): Promise<void> => {
            const own: OwnSession | null = await io.ownSession();
            const notice: ResumeExpiredNotice | null = own === null ? null : resumeExpiredNotice(expired, own);
            if (notice === null) return;
            // Stays until answered: it is the one time the user is told, and they may be away.
            toast({ id: notice.id, title: notice.title, description: notice.description, duration: Infinity,
              action: { label: notice.action, onClick: (): void => { void navigate(notice.signInPath); } } });
          })
          .catch((error: unknown): void => { debugLog('ServerReconnect', 'Showing the expiry notice failed', error); });
        return;
      }
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
      linkOutage.end();
    };
  }, [leave, navigate]);

  return null;
}
