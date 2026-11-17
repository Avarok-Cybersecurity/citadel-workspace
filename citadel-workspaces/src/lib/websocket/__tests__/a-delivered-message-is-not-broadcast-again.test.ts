/**
 * The leader runs two delivery paths, and only one of them may carry a given
 * message.
 *
 * `instanceInboundRouter.routeMessage` forwards to the tab that owns the
 * message's CID. `broadcastChannelService.broadcastWorkspaceResponse` posts it
 * to every tab, which then filters by CID. Both run on every inbound message,
 * so the gate between them decides whether the owning tab sees the message once
 * or twice.
 *
 * That gate used to ask whether the type was in `CID_ROUTED_NOTIFICATIONS` — a
 * list written for a different question (stopping request_id routing), holding
 * nine of the internal service's seventeen notification variants. Everything
 * that routes by CID without being on it was delivered twice. All seven group
 * notifications are built with `request_id: None` and a recipient `cid`, so
 * every group invite, join request, member-state change, leave, end and
 * disconnect arrived twice; a duplicated invite is a duplicated auto-accept.
 * `DisconnectNotification` was worse still — the router broadcasts it to every
 * instance AND the legacy path broadcast it again.
 *
 * The gate now asks the router what it did. These tests drive the real
 * `messageHandler` the leader installs, with the router stubbed to each
 * verdict in turn, so they fail if the gate is inverted, removed, or put back
 * on a list of type names.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const routeMessage: ReturnType<typeof vi.fn<(m: unknown) => boolean>> = vi.hoisted(() =>
  vi.fn<(m: unknown) => boolean>(),
);
const broadcastWorkspaceResponse: ReturnType<typeof vi.fn> = vi.hoisted(() => vi.fn());

vi.mock('../../multi-instance', () => ({
  instanceManager: { isLeader: true, leaderId: 'leader', instanceId: 'leader' },
  instanceInboundRouter: { routeMessage },
  instanceChannel: { send: vi.fn() },
  leaderOutboundHandler: { setWebSocketSendFunction: vi.fn(), setClient: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

vi.mock('../../broadcast-channel-service', () => ({
  broadcastChannelService: {
    getIsLeader: (): boolean => true,
    broadcastWorkspaceResponse,
  },
}));

/** Captures the config the leader hands to the client, then no-ops. */
type CapturedConfig = { messageHandler?: (m: unknown) => void };
const capturedConfig: { current: CapturedConfig | null } = vi.hoisted(() => ({
  current: null,
}));
/**
 * Read through a function so control-flow analysis cannot narrow the slot to
 * `null` from the reset above — the constructor writes it, and TypeScript
 * cannot see that happen.
 */
function captured(): CapturedConfig | null {
  return capturedConfig.current;
}

vi.mock('citadel-workspace-client-ts', () => ({
  WorkspaceClient: class {
    constructor(config: { messageHandler?: (m: unknown) => void }) {
      capturedConfig.current = config;
    }
    // Every agent's first message; this one predates agent hosting.
    async init(): Promise<void> { capturedConfig.current?.messageHandler?.({ ServiceConnectionAccepted: { cid: 0n, request_id: null } }); }
  },
}));

vi.mock('../leader-socket-teardown', () => ({
  setupDisconnectionHandler: vi.fn(),
  setupSessionReleaseHandler: vi.fn(),
  closeLeaderSocket: vi.fn(async () => undefined),
}));

import { WebSocketInitialization } from '../initialization';
import { ReconnectBackoff, AGENT_RECONNECT_BACKOFF, systemClock } from '../reconnect-backoff';

/** A group invite for a follower's session — the shape that was duplicated. */
const GROUP_INVITE: Record<string, unknown> = {
  GroupInviteNotification: { cid: '12345', peer_cid: '99', group_key: 'k', request_id: null },
};

async function handlerForALeader(): Promise<(m: unknown) => void> {
  capturedConfig.current = null;
  const init: WebSocketInitialization = new WebSocketInitialization({
    websocketUrl: 'ws://localhost:12345',
    onClientCreated: vi.fn(),
    onClientReset: vi.fn(),
    releaseSession: vi.fn(),
    // Every socket here is a first open, so spacing never applies.
    reconnectBackoff: new ReconnectBackoff(AGENT_RECONNECT_BACKOFF, systemClock),
    reopen: vi.fn(async () => undefined),
  });
  await init.createWebSocketAsLeader();
  // The socket's greeting went through the same handler; count from here.
  routeMessage.mockClear();
  broadcastWorkspaceResponse.mockClear();
  const handler: ((m: unknown) => void) | undefined = captured()?.messageHandler;
  expect(handler, 'the leader installs a messageHandler').toBeTypeOf('function');
  return handler!;
}

describe('the leader broadcasts only what the router did not deliver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.__citadel_wasm_client_init__ = undefined;
  });

  it('does not broadcast a group invite the router already forwarded', async () => {
    routeMessage.mockReturnValue(true);

    (await handlerForALeader())(GROUP_INVITE);

    expect(routeMessage).toHaveBeenCalledTimes(1);
    expect(broadcastWorkspaceResponse).not.toHaveBeenCalled();
  });

  it('still broadcasts when the router could not deliver it', async () => {
    // The negative control. Without this, a gate hard-wired to "never
    // broadcast" passes the test above while stranding every message the
    // router could not place — an unowned CID, or no CID at all.
    routeMessage.mockReturnValue(false);

    (await handlerForALeader())(GROUP_INVITE);

    expect(broadcastWorkspaceResponse).toHaveBeenCalledTimes(1);
    expect(broadcastWorkspaceResponse.mock.calls[0][0]).toBe(GROUP_INVITE);
  });
});
