/**
 * Tearing down the socket this tab owned while it was leader.
 *
 * Split out of `initialization.ts` so socket creation and socket teardown are
 * not in one file at the 250-line ceiling — they are separately non-obvious.
 */

import type { WorkspaceClient } from 'citadel-workspace-client-ts';
import { eventEmitter } from '../event-emitter';
import { debugLog } from '../debug-config';
import { releaseAfterHolds } from '../multi-instance/release-holds';

export interface TeardownHooks {
  /** Drop the cached client handle. */
  clearClient: () => void;
  onClientReset: () => void;
  releaseSession: (cid: bigint) => void;
}

/**
 * Reset this tab's socket state when the connection drops.
 *
 * Clearing the handle is load-bearing: `createWebSocketAsLeader` returns
 * `leaderClient` when set, so a CLOSED client left there makes every subsequent
 * reconnect hand back the dead client and report success over a socket that is
 * gone — the user sees a green "connection restored" over nothing.
 */
/**
 * The live client, read by the one disconnection handler.
 *
 * Both handlers below were registered inside `doCreateWebSocketAsLeader` with no
 * `off` and no once-guard, so they accumulated one per socket creation. After N
 * drop-and-recreate cycles a single drop ran N+1 teardowns, and one
 * `session:release-request` sent N+1 `ReleaseSession` requests — and each stale
 * closure kept a dead client alive. The guard they needed was already next door,
 * on `registerLeadershipListener`, and was not carried across.
 */
let liveClient: WorkspaceClient | null = null;
let liveHooks: TeardownHooks | null = null;
let liveReleaseHooks: Pick<TeardownHooks, 'releaseSession'> | null = null;
let disconnectionHandlerRegistered: boolean = false;
let sessionReleaseHandlerRegistered: boolean = false;

export function setupDisconnectionHandler(client: WorkspaceClient, hooks: TeardownHooks): void {
  // The client AND the hooks change per socket; the LISTENER does not. Holding
  // them here rather than in the closure is what makes the once-guard safe --
  // otherwise the single surviving listener would keep calling into the first
  // socket's hooks forever.
  liveClient = client;
  liveHooks = hooks;
  if (disconnectionHandlerRegistered) return;
  disconnectionHandlerRegistered = true;

  eventEmitter.on('websocket-disconnected', async () => {
    const client: WorkspaceClient | null = liveClient;
    const hooks: TeardownHooks | null = liveHooks;
    if (!client || !hooks) return;
    debugLog('WebSocketInit', 'WebSocket disconnected event received, stopping message processing and resetting state');
    client.stopMessageProcessing();
    try {
      await client.close();
      debugLog('WebSocketInit', 'WASM client closed successfully');
    } catch (closeError) {
      debugLog('WebSocketInit', 'WASM client close error (ignored):', closeError);
    }

    hooks.clearClient();
    hooks.onClientReset();
    debugLog('WebSocketInit', 'WebSocket service state reset after disconnection');
  });
}

export function setupSessionReleaseHandler(hooks: Pick<TeardownHooks, 'releaseSession'>): void {
  liveReleaseHooks = hooks;
  if (sessionReleaseHandlerRegistered) return;
  sessionReleaseHandlerRegistered = true;

  eventEmitter.on('session:release-request', ({ cid }: { cid: bigint }) => {
    debugLog('WebSocketInit', `Session release requested for CID ${cid.toString()}`);
    // After any goodbye the leader is still sending as this session; see release-holds.ts.
    releaseAfterHolds(cid, (): void => liveReleaseHooks?.releaseSession(cid), (ms: number): Promise<void> => new Promise<void>((done): void => { setTimeout(done, ms); }));
  });
}

/** Stop and close a client this tab is no longer leader for. */
export async function closeLeaderSocket(client: WorkspaceClient): Promise<void> {
  debugLog('WebSocketInit', "Demoted from leader: closing this tab's WebSocket");
  client.stopMessageProcessing();
  try {
    await client.close();
  } catch (closeError) {
    debugLog('WebSocketInit', 'WASM client close error on demotion (ignored):', closeError);
  }
}
