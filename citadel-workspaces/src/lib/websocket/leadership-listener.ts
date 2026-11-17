import { eventEmitter } from '../event-emitter';
import { debugLog } from '@/lib/debug-config';

interface LeadershipOps {
  createWebSocketAsLeader: () => Promise<unknown>;
  closeLeaderClient: () => Promise<void>;
}

/**
 * React to this tab gaining or losing leadership.
 *
 * Extracted so it can be registered from BOTH init paths — it used to live
 * inside `initializeAsFollower`, so a tab that booted as leader never got it and
 * kept a live, deaf socket after demotion.
 */
export function installLeadershipListener(ops: LeadershipOps): void {
  // Both directions. Handling only promotion left a demoted leader holding a
  // live socket forever — none of the ten 'leader-changed' subscribers closed
  // one — so a reload of the older of two tabs left the browser with two.
  // NOT async: `emit` invokes handlers synchronously, so an async handler's
  // rejection escapes the emitter's try/catch and nothing observes it. A
  // promotion whose socket failed left this tab isLeader with no send
  // function, answering every request from every tab "WebSocket not ready".
  eventEmitter.on('instance:leader-changed', ({ isLeader: newIsLeader }: { isLeader: boolean; leaderId: string }) => {
    if (newIsLeader) {
      debugLog('WebSocketInit', 'Became leader! Creating WebSocket connection...');
      void ops.createWebSocketAsLeader().catch((error: unknown) => {
        debugLog('WebSocketInit', 'Promotion failed; handing leadership back', error);
        // Lazily imported: instance-channel already reaches back into this
        // module's world through the election path, and a static import here
        // closes that cycle.
        void import('../multi-instance/instance-channel').then(({ instanceChannel }) =>
          instanceChannel.relinquishLeadership()
        );
      });
    } else {
      void ops.closeLeaderClient().catch((error: unknown) => {
        debugLog('WebSocketInit', 'Demotion teardown failed (ignored)', error);
      });
    }
  });
}
