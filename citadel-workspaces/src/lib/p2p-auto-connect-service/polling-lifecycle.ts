/**
 * When the auto-connect polls run: from a session's start until its end, minus
 * the time the socket is down (a dropped socket stops them, the next one resumes
 * them), and on the leader tab only.
 */
import { eventEmitter } from '../event-emitter';
import { debugLog } from '@/lib/debug-config';
import type { AutoConnectState } from './state';
import { startPolling, stopPolling, startBackendPolling, stopBackendPolling } from './polling';

export function installPollingLifecycle(state: AutoConnectState, connectAll: () => Promise<void>): void {
  // Whether a session is being served. A dropped socket stops the polls but not this: the
  // socket coming back resumes them. Logout and a session gone from the agent end it.
  let serving: boolean = false;
  const resume = (): void => {
    startPolling(state, connectAll);
    startBackendPolling(state);
  };
  eventEmitter.on('p2p:registration-service-started', () => {
    serving = true;
    resume();
  });
  eventEmitter.on('on-ws-connection-success', () => { if (serving) resume(); });

  const stopAll = (): void => { stopPolling(state); stopBackendPolling(state); state.cancelAllRetries(); };
  eventEmitter.on('p2p:registration-service-stopped', () => { serving = false; stopAll(); });
  // The agent no longer holds this tab's session: its ListAllPeers would be refused for ever.
  eventEmitter.on('p2p:session-gone-from-agent', ({ cid }: { cid: bigint }) => {
    debugLog('P2PAutoConnectService', `[P2PAutoConnect] Agent no longer holds session ${cid.toString()}, stopping all polling`);
    serving = false;
    stopAll();
  });

  eventEmitter.on('websocket-disconnected', ({ reason }: { reason: string }) => {
    debugLog('P2PAutoConnectService', `[P2PAutoConnect] WebSocket disconnected: ${reason}, stopping all polling`);
    stopAll();
  });

  eventEmitter.on('connection-failure', ({ error }: { error: string }) => {
    debugLog('P2PAutoConnectService', `[P2PAutoConnect] Connection failure: ${error}, stopping all polling`);
    stopAll();
  });

  eventEmitter.on('instance:leader-changed', (data: { isLeader: boolean; leaderId: string }) => {
    debugLog('P2PAutoConnectService', `[P2PAutoConnect] Leader changed - isLeader: ${data.isLeader}`);
    if (data.isLeader) {
      startPolling(state, connectAll);
      startBackendPolling(state);
    } else {
      stopAll();
    }
  });
}
