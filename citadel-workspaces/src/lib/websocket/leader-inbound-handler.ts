/**
 * What the leader tab does with a message off the wire.
 *
 * Split out of initialization.ts, which is one of the files held at the repo's
 * 250-line cap, and split along this seam on purpose: everything else in that
 * file is about OWNING the socket — creating it, caching it, tearing it down on
 * demotion. This is the one part that is about a message, and it is the part
 * with a rule in it.
 *
 * The rule: the leader runs two delivery paths, and only one of them may carry
 * a given message. `instanceInboundRouter.routeMessage` forwards to the tab that
 * owns the message's CID; `broadcastWorkspaceResponse` posts it to every tab,
 * which then filters by CID. Broadcasting something the router already delivered
 * hands the owning tab the same message twice, and a duplicated group invite is
 * a duplicated auto-accept.
 *
 * The gate used to ask whether the type was in `CID_ROUTED_NOTIFICATIONS` — a
 * list written to stop request_id routing, borrowed here for a different
 * question. It held nine of the internal service's seventeen notification
 * variants, so everything that routes by CID without being on it arrived twice:
 * every group notification (all seven are built with `request_id: None` and a
 * recipient `cid`), and `DisconnectNotification`, which the router already
 * broadcasts to everyone.
 *
 * Asking the router what it actually DID cannot drift the way a hand-kept list
 * of type names does.
 */
import { debugLog } from '../debug-config';
import { broadcastChannelService } from '../broadcast-channel-service';
import { instanceManager, instanceInboundRouter } from '../multi-instance';
import type { InternalServiceResponse, ResponseType } from 'citadel-workspace-client-ts';
import { eventEmitter } from '../event-emitter';
import { arrivesAtFrameRate, getMessageType } from '../multi-instance/routing-rules';

/**
 * Every message off the wire, on the leader, BEFORE routing.
 *
 * For exchanges the leader runs on another tab's behalf: it looks up relay servers for a
 * follower's session, and the answer names that session, so the router hands it to the
 * follower and the leader's own bus never sees it. Seen live: every such lookup timed out
 * at 5 s with its answer already delivered at 222 ms, and the connection went ahead
 * without a relay. Routing is unchanged; this only lets the asker observe.
 */
export const LEADER_WIRE_EVENT: 'leader:wire-message' = 'leader:wire-message';

/**
 * Build the `messageHandler` the leader hands to its WorkspaceClient.
 *
 * `forward` is the caller's own handler, run last and unconditionally — it is
 * the service's public hook, not part of the routing decision.
 */
export function leaderInboundHandler(
  forward?: (message: unknown) => void,
): (message: InternalServiceResponse) => void {
  return (message: InternalServiceResponse): void => {
    // Not per frame: see arrivesAtFrameRate.
    const perFrame: boolean = arrivesAtFrameRate(getMessageType(message));
    if (!perFrame) debugLog('WebSocketInit', 'Message received from WASM client', message);

    let deliveredByRouter: boolean = false;
    if (instanceManager.isLeader) {
      eventEmitter.emit(LEADER_WIRE_EVENT, message);
      deliveredByRouter = instanceInboundRouter.routeMessage(message);
    } else {
      // Drop, do not emit: emitting bypasses the router's CID filtering, so
      // another session's traffic lands in this tab's bus. closeLeaderClient
      // makes this a fail-safe, not a delivery path.
      debugLog('WebSocketInit', 'Dropping message received after demotion');
    }

    if (broadcastChannelService.getIsLeader()) {
      // Only what the router did NOT deliver. See the header.
      if (!deliveredByRouter) {
        broadcastChannelService.broadcastWorkspaceResponse(message);
      } else if (!perFrame) {
        const messageType: ResponseType | undefined = Object.keys(message)[0] as
          | ResponseType
          | undefined;
        debugLog(
          'WebSocketInit',
          `Skipping legacy broadcast for ${messageType ?? 'message'} (delivered by instanceInboundRouter)`,
        );
      }
    }

    if (forward) forward(message);
  };
}
