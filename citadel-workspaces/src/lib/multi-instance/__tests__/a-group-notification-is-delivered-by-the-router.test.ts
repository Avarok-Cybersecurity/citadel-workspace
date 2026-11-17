/**
 * The router reports whether it DELIVERED a message, and for group
 * notifications the answer is yes.
 *
 * `routeMessage` used to return nothing. The one caller that needed to know —
 * the leader's WebSocket handler, which runs a second delivery path
 * (`broadcastWorkspaceResponse`) alongside the router — decided instead by
 * asking whether the type was in `CID_ROUTED_NOTIFICATIONS`. That list was
 * written to stop request_id routing, and it holds nine entries; the internal
 * service defines seventeen notification variants. The seven group
 * notifications are all built with `request_id: None` and a recipient `cid`
 * (see `kernel/responses/group_event.rs` and `kernel/requests/mod.rs`), so the
 * router routes every one of them by CID — and the broadcast then sent each a
 * second time. The owning tab received every group invite, join request,
 * member-state change, leave, end and disconnect TWICE, and a duplicated
 * invite is a duplicated auto-accept.
 *
 * This file pins the router's half: for a group notification addressed to a
 * known instance, `routeMessage` forwards it and returns true. The caller's
 * half — that a true verdict suppresses the broadcast — is pinned in
 * websocket/__tests__/a-delivered-message-is-not-broadcast-again.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eventEmitter } from '../../event-emitter';
import type { ResponseType } from 'citadel-workspace-client-ts';

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
  findInstancesByCid: ReturnType<typeof vi.fn<(cid: bigint) => string[]>>;
  getAllInstances: ReturnType<typeof vi.fn>;
  registerInstance: ReturnType<typeof vi.fn>;
} = vi.hoisted(() => ({
  instanceId: 'leader-instance', isLeader: true, // the router reads leadership here, not from the event
  findInstancesByCid: vi.fn<(cid: bigint) => string[]>(),
  getAllInstances: vi.fn(() => [] as Array<{ instanceId: string; cid: bigint | null }>),
  registerInstance: vi.fn(),
}));

vi.mock('../instance-channel', () => ({ instanceChannel: instanceChannelMock }));
vi.mock('../instance-manager', () => ({ instanceManager: instanceManagerMock }));

import { instanceInboundRouter } from '../instance-inbound-router';

/**
 * Every group notification the internal service can send.
 *
 * `satisfies ResponseType[]` is the guard that keeps this list real: a renamed
 * or removed variant stops compiling here rather than quietly dropping out of
 * the assertion. It is the same device `BROADCAST_MESSAGE_TYPES` uses next
 * door, for the same reason.
 *
 * Seven of these eight were the ones delivered twice. `GroupMessageNotification`
 * was already on `CID_ROUTED_NOTIFICATIONS` and so already suppressed; it is
 * asserted here anyway, because the verdict must be right for it too and
 * because nothing should depend on which list somebody remembered to edit.
 */
const GROUP_NOTIFICATIONS: readonly ["GroupInviteNotification", "GroupJoinRequestNotification", "GroupMemberStateChangeNotification", "GroupLeaveNotification", "GroupEndNotification", "GroupDisconnectNotification", "GroupRequestJoinPendingNotification", "GroupMessageNotification"] = [
  'GroupInviteNotification',
  'GroupJoinRequestNotification',
  'GroupMemberStateChangeNotification',
  'GroupLeaveNotification',
  'GroupEndNotification',
  'GroupDisconnectNotification',
  'GroupRequestJoinPendingNotification',
  'GroupMessageNotification',
] as const satisfies readonly ResponseType[];

describe('a group notification is delivered by the router, once', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventEmitter.emit('instance:leader-changed', {
      isLeader: true,
      leaderId: 'leader-instance',
    });
  });

  for (const type of GROUP_NOTIFICATIONS) {
    it(`${type} is forwarded to the owning tab and reported as delivered`, () => {
      instanceManagerMock.findInstancesByCid.mockReturnValue(['follower-instance']);

      const delivered: boolean = instanceInboundRouter.routeMessage({
        [type]: { cid: '12345', peer_cid: '99', request_id: null },
      });

      expect(instanceChannelMock.forwardToInstance).toHaveBeenCalledTimes(1);
      expect(instanceChannelMock.forwardToInstance.mock.calls[0][0]).toBe('follower-instance');
      // Without a true verdict here the caller broadcasts it a second time.
      expect(delivered).toBe(true);
    });
  }

  it('reports NOT delivered when no instance owns the CID', () => {
    // The negative control for the verdict: a router that returned a constant
    // `true` would satisfy every assertion above, and would then suppress the
    // broadcast that is this message's only remaining chance of arriving.
    instanceManagerMock.findInstancesByCid.mockReturnValue([]);

    const delivered: boolean = instanceInboundRouter.routeMessage({
      GroupInviteNotification: { cid: '999', peer_cid: '99', request_id: null },
    });

    expect(instanceChannelMock.forwardToInstance).not.toHaveBeenCalled();
    expect(delivered).toBe(false);
  });

  it('reports NOT delivered when the message carries no CID at all', () => {
    // Nobody can own it, so the leader takes it locally and the broadcast
    // remains the only path to a follower.
    const delivered: boolean = instanceInboundRouter.routeMessage({
      GroupEndNotification: { group_key: 'k', success: true, request_id: null },
    });

    expect(delivered).toBe(false);
  });
});
