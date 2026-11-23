/**
 * When this window's account is signed out or deleted in another window, it
 * leaves the workspace for the landing page and says so (lib/sessions/
 * session-ended.ts). Inside the router, like ServerReconnectWatcher, because
 * leaving navigates.
 */
import { useEffect } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { getSelectedUser, type TabUserContext } from '@/lib/tab-context';
import { endedElsewhere, endedMessage, type SessionEnded } from '@/lib/sessions/session-ended';
import { errorLog } from '@/lib/debug-config';
import { outage, showsSessionGone } from '@/lib/reconnect/outage';
import { linkOutage } from '@/lib/reconnect/link-outage';
import { useLeaveEndedSession, type LeaveEndedSession } from './use-leave-ended-session';

export function SessionEndedWatcher(): null {
  const leave: LeaveEndedSession = useLeaveEndedSession();

  useEffect(() => {
    const onMessage = (message: unknown): void => {
      const ended: SessionEnded | null = endedElsewhere(message);
      if (!ended) return;
      getSelectedUser()
        .then((tab: TabUserContext | null): Promise<void> | undefined => {
          if (tab?.selectedCid !== ended.cid) return undefined;
          // The agent gave up on this session's server and the page already says so, with the
          // way back: its end is that same event, not a sign-out in another window.
          if (showsSessionGone(outage.get(), ended.cid)) return undefined;
          // It ended while its link was down: nothing is left to wait for.
          linkOutage.end();
          return leave('/', endedMessage(tab.selectedUsername ?? 'This account', ended.reason));
        })
        .catch((error: unknown): void => errorLog('Sessions', 'could not leave a workspace whose session ended', error));
    };
    return eventEmitter.on('websocket-message', onMessage);
  }, [leave]);

  return null;
}
