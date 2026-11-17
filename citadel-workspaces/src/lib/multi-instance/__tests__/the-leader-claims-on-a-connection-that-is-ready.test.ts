/**
 * The leader claims its tabs' sessions on a connection that can carry the claim.
 *
 * Seen on the live site, in a loop: "[FollowerSessionClaims] claiming <cid> for another tab
 * failed Error: WebSocket client not available (leader without client)", twice per cycle --
 * this tab's own session and the other tab's. A follower promoted to leader claimed both the
 * moment it was promoted, before the socket the promotion opens existed; `sendRequest`
 * refused each claim, and only the claims made when the socket opened went out.
 *
 * Real: the service singleton and the installer wired to it (websocket-service/index.ts),
 * the socket's creation and teardown, the instance manager and its registry, the inbound
 * router and request/response matching, and the event bus. Stood in, each because it cannot
 * exist in vitest:
 * - the WASM WorkspaceClient: a socket that takes a moment to open, as a real one does, then
 *   greets as an agent does and answers ClaimSession;
 * - IndexedDB, which jsdom lacks: storage-utils over a Map (the connection service reads the
 *   tab's selected user from it on every ConnectionManagement answer);
 * - every timer (fake setInterval AND setTimeout, so `vi.waitFor` moves time): another tab is
 *   not there to send heartbeats, so this tab's leadership changes only when the test emits
 *   the election's own event. With real timeouts, a loaded machine that took over 2.5s to load
 *   these modules let the election's initial wait fire first, and the tab led before the test
 *   made it a follower -- the cause of the "Not leader" claim failures seen only under load.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

const socket: { sent: Array<Record<string, unknown>>; opened: number } = vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  return { sent: [], opened: 0 };
});
const deviceStore: Map<string, unknown> = vi.hoisted((): Map<string, unknown> => new Map<string, unknown>());
/** A socket opens over the network, never within the same turn of the event loop. */
const OPEN_TAKES_MS: number = 20;

vi.mock('@/lib/storage-utils', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  ...(await import('@/lib/cdoc/collab/__tests__/doubles/memory-storage')).memoryStorageUtils(deviceStore),
}));

vi.mock('citadel-workspace-client-ts', async (importOriginal: () => Promise<typeof import('citadel-workspace-client-ts')>) => {
  const real: typeof import('citadel-workspace-client-ts') = await importOriginal();
  class FakeSocket {
    private readonly handler: (message: unknown) => void;
    constructor(config: { messageHandler: (message: unknown) => void }) { this.handler = config.messageHandler; }
    async init(): Promise<void> {
      await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, OPEN_TAKES_MS); });
      socket.opened += 1;
      this.handler({ ServiceConnectionAccepted: { cid: 0n, request_id: null } });
    }
    async sendDirectToInternalService(request: Record<string, unknown>): Promise<void> {
      socket.sent.push(request);
      const management: { request_id: string; management_command: { ClaimSession?: { session_cid: bigint } } } | undefined =
        request.ConnectionManagement as { request_id: string; management_command: { ClaimSession?: { session_cid: bigint } } } | undefined;
      const claim: { session_cid: bigint } | undefined = management?.management_command.ClaimSession;
      if (management && claim) {
        queueMicrotask((): void => this.handler({ ConnectionManagementSuccess: { request_id: management.request_id, cid: claim.session_cid, message: 'claimed' } }));
      }
    }
    stopMessageProcessing(): void {}
    async close(): Promise<void> {}
  }
  return { ...real, WorkspaceClient: FakeSocket };
});

import { websocketService } from '@/lib/websocket-service';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { eventEmitter } from '@/lib/event-emitter';
import { outboundQueue } from '@/lib/multi-instance/outbound-queue';

const OWN_CID: bigint = 901n;
const OTHER_CID: bigint = 902n;

function claimedOnTheSocket(): bigint[] {
  return socket.sent
    .map((r: Record<string, unknown>) => (r.ConnectionManagement as { management_command?: { ClaimSession?: { session_cid: bigint } } } | undefined)?.management_command?.ClaimSession?.session_cid)
    .filter((cid: bigint | undefined): cid is bigint => cid !== undefined);
}

const failedClaims: string[] = [];
const realConsoleError: typeof console.error = console.error;

beforeAll(async (): Promise<void> => {
  console.error = (...args: unknown[]): void => {
    if (String(args[0]).includes('FollowerSessionClaims')) failedClaims.push(args.map(String).join(' '));
  };
  // This tab boots as a follower of another tab, holding a session of its own.
  instanceManager.registerInstance(instanceManager.instanceId, OWN_CID);
  instanceManager.registerInstance('other-tab', OTHER_CID);
  eventEmitter.emit('instance:leader-changed', { isLeader: false, leaderId: 'other-tab' });
  await websocketService.init();
  expect(websocketService.client).toBeNull();
});

afterAll((): void => {
  console.error = realConsoleError;
  vi.useRealTimers();
});

describe('a follower promoted to leader', () => {
  it('claims every session once, on the socket its promotion opened, and no claim fails', async () => {
    // The old leader's tab went away; the election promotes this one.
    eventEmitter.emit('instance:leader-changed', { isLeader: true, leaderId: instanceManager.instanceId });

    await vi.waitFor((): void => { expect(claimedOnTheSocket().sort()).toEqual([OWN_CID, OTHER_CID]); });
    await vi.waitFor((): void => { expect(websocketService.client).not.toBeNull(); });

    expect(socket.opened).toBe(1);
    expect(failedClaims).toEqual([]);
  });

  it('claims them again on the socket that replaces a dropped one, and no claim fails', async () => {
    socket.sent.length = 0;
    failedClaims.length = 0;
    eventEmitter.emit('websocket-disconnected', { reason: 'WebSocket communication task ended' });

    // The leader re-opens on its own, after the reconnect backoff's first window.
    await vi.waitFor((): void => { expect(socket.opened).toBe(2); }, { timeout: 5000 });
    await vi.waitFor((): void => { expect(claimedOnTheSocket().sort()).toEqual([OWN_CID, OTHER_CID]); });

    expect(failedClaims).toEqual([]);
  });

  it('demoted, then promoted again, claims on the new socket again, and no claim fails', async () => {
    eventEmitter.emit('instance:leader-changed', { isLeader: false, leaderId: 'other-tab' });
    await vi.waitFor((): void => { expect(websocketService.client).toBeNull(); });
    // Its next request, as a follower, initialises it as one.
    await websocketService.init();
    socket.sent.length = 0;
    failedClaims.length = 0;

    eventEmitter.emit('instance:leader-changed', { isLeader: true, leaderId: instanceManager.instanceId });

    await vi.waitFor((): void => { expect(socket.opened).toBe(3); });
    await vi.waitFor((): void => { expect(claimedOnTheSocket().sort()).toEqual([OWN_CID, OTHER_CID]); });
    expect(failedClaims).toEqual([]);
  });

  it('sends a request made the moment it is promoted, on the socket the promotion opens', async () => {
    eventEmitter.emit('instance:leader-changed', { isLeader: false, leaderId: 'other-tab' });
    await vi.waitFor((): void => { expect(websocketService.client).toBeNull(); });
    await websocketService.init();
    socket.sent.length = 0;

    eventEmitter.emit('instance:leader-changed', { isLeader: true, leaderId: instanceManager.instanceId });
    const requestId: string = crypto.randomUUID();
    const sending: Promise<void> = websocketService.sendRequest({ GetSessions: { request_id: requestId } });
    await vi.advanceTimersByTimeAsync(OPEN_TAKES_MS);
    await sending;

    expect(socket.sent).toContainEqual({ GetSessions: { request_id: requestId } });
    expect(socket.opened).toBe(4);
  });

  it('sends a request it proxied to a leader that went away, once it is promoted itself', async () => {
    eventEmitter.emit('instance:leader-changed', { isLeader: false, leaderId: 'other-tab' });
    await vi.waitFor((): void => { expect(websocketService.client).toBeNull(); });
    await websocketService.init();
    socket.sent.length = 0;

    // Proxied to 'other-tab', which closed before answering: the request waits in the queue.
    const requestId: string = crypto.randomUUID();
    let outcome: string = 'pending';
    websocketService.sendRequest({ GetSessions: { request_id: requestId } })
      .then((): void => { outcome = 'sent'; }, (error: unknown): void => { outcome = String(error); });
    await vi.waitFor((): void => { expect(outboundQueue.getStats().size).toBe(1); });

    // The election promotes this tab, and the queue replays the request to its new leader.
    eventEmitter.emit('instance:leader-changed', { isLeader: true, leaderId: instanceManager.instanceId });

    await vi.waitFor((): void => { expect(outcome).toBe('sent'); });
    expect(socket.sent).toContainEqual({ GetSessions: { request_id: requestId } });
  });
});
