/**
 * A PeerPathChangedNotification reaches the tab holding the session in its `cid`.
 *
 * The agent sends one whenever an established peer connection changes path
 * (relay -> direct, or back). It answers no request: `request_id` is null, so
 * `cid` is the only way to its owner. It is in CID_ROUTED_NOTIFICATIONS so that
 * holds even if a request_id ever rides along: routed by request_id it would go
 * to whichever tab issued that request, and one session's chat header would
 * show another session's path.
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

const instanceManagerMock: {
  instanceId: string; isLeader: boolean;
  findInstanceByCid: ReturnType<typeof vi.fn<(cid: bigint) => string | null>>;
  findInstancesByCid(cid: bigint): string[];
  getAllInstances: ReturnType<typeof vi.fn>;
  registerInstance: ReturnType<typeof vi.fn>;
} = vi.hoisted(() => ({
  instanceId: 'leader-instance', isLeader: true, // the router reads leadership here, not from the event
  findInstanceByCid: vi.fn<(cid: bigint) => string | null>(),
  // One holder at most in these tests: the plural answer the router reads, from the one mocked.
  findInstancesByCid(cid: bigint): string[] { const one: string | null = this.findInstanceByCid(cid); return one ? [one] : []; },
  getAllInstances: vi.fn(() => [] as Array<{ instanceId: string; cid: bigint | null }>),
  registerInstance: vi.fn(),
}));

// The two cross-tab transports, as in a-group-notification-is-delivered-by-the-router:
// there is no second tab here, so these are where a routing decision is observed.
vi.mock('../instance-channel', () => ({ instanceChannel: instanceChannelMock }));
vi.mock('../instance-manager', () => ({ instanceManager: instanceManagerMock }));

import { instanceInboundRouter } from '../instance-inbound-router';

const change = (requestId: string | null): Record<string, unknown> => ({
  PeerPathChangedNotification: { cid: 12345n, peer_cid: 99n, path: 'direct', upgrading: false, request_id: requestId },
});

describe('a path change is routed by the session it names', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventEmitter.emit('instance:leader-changed', { isLeader: true, leaderId: 'leader-instance' });
    instanceManagerMock.findInstanceByCid.mockImplementation((cid: bigint): string | null => (cid === 12345n ? 'owner-tab' : null));
  });

  it('is forwarded to the tab holding its cid', () => {
    expect(instanceInboundRouter.routeMessage(change(null))).toBe(true);
    expect(instanceChannelMock.forwardToInstance).toHaveBeenCalledTimes(1);
    expect(instanceChannelMock.forwardToInstance.mock.calls[0][0]).toBe('owner-tab');
  });

  it('goes to that tab even when a request_id belongs to another one', () => {
    instanceInboundRouter.registerPendingRequest('asked-by-other', 'other-tab');

    expect(instanceInboundRouter.routeMessage(change('asked-by-other'))).toBe(true);
    const targets: unknown[] = instanceChannelMock.forwardToInstance.mock.calls.map((c: unknown[]) => c[0]);
    expect(targets).toEqual(['owner-tab']);
  });
});
