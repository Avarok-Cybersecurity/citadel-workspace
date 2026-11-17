/**
 * A P2P internal-HTTP frame reaches the tab holding the session in its `cid`, with two
 * sessions in one browser.
 *
 * `IhttpFrameNotification.request_id` is the sending peer's. When the peer is the OTHER
 * session in this same browser, that id is one a tab here registered, so routing by it hands
 * the frame to the sender's tab: one account's app would serve the other account's call.
 * It is in CID_ROUTED_NOTIFICATIONS so `cid` decides.
 *
 * The two cross-tab transports are doubles, as in a-path-change-reaches-the-session-it-names:
 * there is no second tab in jsdom, so the forward call is where the routing decision shows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eventEmitter } from '../../event-emitter';

const instanceChannelMock: {
  requestCidReport: ReturnType<typeof vi.fn>;
  forwardToInstance: ReturnType<typeof vi.fn>;
  broadcast: ReturnType<typeof vi.fn>;
} = vi.hoisted(() => ({
  requestCidReport: vi.fn(),
  forwardToInstance: vi.fn(),
  broadcast: vi.fn(),
}));

const ALICE: bigint = 1001n;
const BOB: bigint = 2002n;

const instanceManagerMock: {
  instanceId: string; isLeader: boolean;
  findInstanceByCid: ReturnType<typeof vi.fn<(cid: bigint) => string | null>>;
  findInstancesByCid(cid: bigint): string[];
  getAllInstances: ReturnType<typeof vi.fn>;
  registerInstance: ReturnType<typeof vi.fn>;
} = vi.hoisted(() => ({
  instanceId: 'leader-instance', isLeader: true, // the router reads leadership here, not from the event
  findInstanceByCid: vi.fn<(cid: bigint) => string | null>(),
  findInstancesByCid(cid: bigint): string[] { const one: string | null = this.findInstanceByCid(cid); return one ? [one] : []; },
  getAllInstances: vi.fn(() => [] as Array<{ instanceId: string; cid: bigint | null }>),
  registerInstance: vi.fn(),
}));

vi.mock('../instance-channel', () => ({ instanceChannel: instanceChannelMock }));
vi.mock('../instance-manager', () => ({ instanceManager: instanceManagerMock }));

import { instanceInboundRouter } from '../instance-inbound-router';

const frameFor = (cid: bigint, from: bigint, requestId: string | null): Record<string, unknown> => ({
  IhttpFrameNotification: { cid, peer_cid: from, frame: [0xa1, 1, 2], request_id: requestId },
});

describe('an ihttp frame is routed by the session it names', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventEmitter.emit('instance:leader-changed', { isLeader: true, leaderId: 'leader-instance' });
    instanceManagerMock.findInstanceByCid.mockImplementation((cid: bigint): string | null =>
      cid === ALICE ? 'alice-tab' : cid === BOB ? 'bob-tab' : null);
  });

  it('goes to Bob’s tab when Alice’s tab sent it, under Alice’s request id', () => {
    instanceInboundRouter.registerPendingRequest('alice-send', 'alice-tab');

    expect(instanceInboundRouter.routeMessage(frameFor(BOB, ALICE, 'alice-send'))).toBe(true);
    const targets: unknown[] = instanceChannelMock.forwardToInstance.mock.calls.map((c: unknown[]) => c[0]);
    expect(targets).toEqual(['bob-tab']);
  });

  it('goes to Alice’s tab when Bob’s tab answered, under Bob’s request id', () => {
    instanceInboundRouter.registerPendingRequest('bob-send', 'bob-tab');

    expect(instanceInboundRouter.routeMessage(frameFor(ALICE, BOB, 'bob-send'))).toBe(true);
    const targets: unknown[] = instanceChannelMock.forwardToInstance.mock.calls.map((c: unknown[]) => c[0]);
    expect(targets).toEqual(['alice-tab']);
  });
});
