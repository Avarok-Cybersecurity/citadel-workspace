/**
 * A request received is not a relationship established.
 *
 * `handlePeerRegisterNotification` — which fires when someone sends US a
 * registration request — set `isRegistered = true` and added the sender to
 * `registeredPeers`, before any accept. The backend defines registered as
 * mutual: `list_registered` answers from `GetMutuals`.
 *
 * That was not cosmetic. `MessageSender` checks `isPeerRegistered` and skips
 * registration when it is true, so a first message to someone whose request was
 * merely pending went out against a peer with no mutual registration and no
 * ratchet, and failed. The peer also appeared among the user's connections
 * before they had agreed to anything.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleWebSocketMessage } from '../registration';
import type { Peer } from '../types';

// Which session THIS tab is running as. The handler now refuses to act on a
// notification addressed to a different one -- see
// lib/sessions/notification-ownership.ts -- so the tests have to say who they
// are. Before the guard they did not, and the flow ran for anybody.
const tabCid: { value: bigint | null } = { value: 7n };
vi.mock('../discovery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../discovery')>()),
  getCurrentCid: (): Promise<bigint | null> => Promise.resolve(tabCid.value),
}));

/** The guard runs in a microtask, so assertions on it must let one pass. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function context(): {
  pendingRequests: Map<bigint, unknown>;
  allPeers: Map<bigint, Peer>;
  registeredPeers: Map<bigint, Peer>;
  outgoingRegistrations: Set<bigint>;
  incomingRegistrations: Set<bigint>;
  handleIncomingRegistration: ReturnType<typeof vi.fn>;
} {
  return {
    pendingRequests: new Map(),
    allPeers: new Map<bigint, Peer>(),
    registeredPeers: new Map<bigint, Peer>(),
    outgoingRegistrations: new Set<bigint>(),
    incomingRegistrations: new Set<bigint>(),
    handleIncomingRegistration: vi.fn(() => Promise.resolve()),
  };
}

/** Delivered through the real entry point, as the socket would. */
function deliverRequest(ctx: ReturnType<typeof context>): void {
  handleWebSocketMessage({ PeerRegisterNotification: notification } as never, ctx as never);
}

const notification: { cid: bigint; peer_cid: bigint; peer_username: string; request_id: string; } = {
  cid: 7n,
  peer_cid: 42n,
  peer_username: 'alice',
  request_id: 'req-1',
};

let ctx: ReturnType<typeof context>;

beforeEach(() => {
  ctx = context();
  tabCid.value = 7n;
});

describe('an incoming registration request', () => {
  it('does not claim the sender is registered', () => {
    deliverRequest(ctx);

    expect(ctx.registeredPeers.has(42n)).toBe(false);
    expect(ctx.allPeers.get(42n)?.isRegistered).toBe(false);
  });

  it('still learns the sender, so the request shows a name not a CID', () => {
    deliverRequest(ctx);

    expect(ctx.allPeers.get(42n)?.username).toBe('alice');
  });

  it('still runs the pending-request flow', async () => {
    deliverRequest(ctx);
    await settle();

    expect(ctx.handleIncomingRegistration).toHaveBeenCalledWith(7n, 42n, 'alice');
  });

  /**
   * The cross-account defect. One browser holds one WebSocket for every logged
   * in account, and the router has three paths that hand a notification to a
   * tab which does not own its cid. With auto-accept on, this flow registers
   * back using THIS tab's cid -- so a request addressed to account 7, landing
   * in a tab running as account 99, made 99 register with the stranger who
   * asked for 7, while 7 never saw the request.
   */
  it('does not run the flow for a notification addressed to another session', async () => {
    tabCid.value = 99n;

    deliverRequest(ctx);
    await settle();

    expect(ctx.handleIncomingRegistration).not.toHaveBeenCalled();
  });

  /**
   * The leader tab is very often the landing page, which has no session at
   * all. "I am nobody" must not mean "everything is mine".
   */
  it('does not run the flow when this tab has no session', async () => {
    tabCid.value = null;

    deliverRequest(ctx);
    await settle();

    expect(ctx.handleIncomingRegistration).not.toHaveBeenCalled();
  });

  it('does not downgrade a peer who IS already mutually registered', () => {
    // A second request from someone already registered — a resend, which the
    // sender does every five minutes — must not un-register them.
    const existing: Peer = {
      cid: 42n,
      username: 'alice',
      fullName: 'Alice',
      isOnline: true,
      isRegistered: true,
    };
    ctx.allPeers.set(42n, existing);
    ctx.registeredPeers.set(42n, existing);

    deliverRequest(ctx);

    expect(ctx.registeredPeers.has(42n)).toBe(true);
    expect(ctx.allPeers.get(42n)?.isRegistered).toBe(true);
  });
});
