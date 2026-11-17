/**
 * A security-key challenge goes to the window whose request caused it, and the
 * answer that request is really waiting for still follows it there.
 *
 * During a sign-in the challenge's `cid` is 0 (there is no session yet), so the
 * request id is the only route to the asking tab. It used to be spent on the
 * first message that carried it: the challenge arrived, consumed the pending
 * entry, and the ConnectSuccess after the touch had no route -- with cid known
 * only to the agent, it fell to the leader, and the follower that signed in
 * waited out its timeout on a sign-in that had worked. RegisterSuccess has the
 * same shape now that it is sent ahead of the connect's own answer.
 *
 * The two cross-tab transports are doubled, as in a-path-change-reaches-the-
 * session-it-names: there is no second tab here, so they are where a routing
 * decision is observed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eventEmitter } from '../../event-emitter';

const channel: { requestCidReport: ReturnType<typeof vi.fn>; forwardToInstance: ReturnType<typeof vi.fn>; broadcast: ReturnType<typeof vi.fn> } =
  vi.hoisted(() => ({ requestCidReport: vi.fn(), forwardToInstance: vi.fn(), broadcast: vi.fn() }));
const manager: {
  instanceId: string; isLeader: boolean; findInstanceByCid: ReturnType<typeof vi.fn>; findInstancesByCid: () => string[];
  getAllInstances: ReturnType<typeof vi.fn>; registerInstance: ReturnType<typeof vi.fn>;
} = vi.hoisted(() => ({
  instanceId: 'leader-tab', isLeader: true, /* the router reads leadership here, not from the event */ findInstanceByCid: vi.fn(() => null), findInstancesByCid: (): string[] => [],
  getAllInstances: vi.fn(() => []), registerInstance: vi.fn(),
}));
vi.mock('../instance-channel', () => ({ instanceChannel: channel }));
vi.mock('../instance-manager', () => ({ instanceManager: manager }));

import { instanceInboundRouter } from '../instance-inbound-router';

const challenge = (requestId: string): Record<string, unknown> => ({
  SecurityKeyChallengeNotification: {
    cid: 0n, request_id: requestId, challenge_id: 'c-1', purpose: 'SignIn',
    allowed_credential_ids: [[1, 2]], prf_salt: [9], expires_in_ms: 60000n,
  },
});
const targets = (): unknown[] => channel.forwardToInstance.mock.calls.map((c: unknown[]) => c[0]);

describe('a security-key challenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventEmitter.emit('instance:leader-changed', { isLeader: true, leaderId: 'leader-tab' });
  });

  it('goes only to the follower whose Connect asked, and its ConnectSuccess follows', () => {
    instanceInboundRouter.registerPendingRequest('bobs-connect', 'bob-tab');
    instanceInboundRouter.registerPendingRequest('carols-connect', 'carol-tab');

    expect(instanceInboundRouter.routeMessage(challenge('bobs-connect'))).toBe(true);
    expect(instanceInboundRouter.routeMessage({ ConnectSuccess: { cid: 22n, request_id: 'bobs-connect' } })).toBe(true);

    expect(targets()).toEqual(['bob-tab', 'bob-tab']);
  });

  it('and a registration\'s connect answer still follows its RegisterSuccess', () => {
    instanceInboundRouter.registerPendingRequest('bobs-register', 'bob-tab');

    instanceInboundRouter.routeMessage({ RegisterSuccess: { cid: 23n, request_id: 'bobs-register', recovery_codes: [] } });
    instanceInboundRouter.routeMessage({ ConnectSuccess: { cid: 23n, request_id: 'bobs-register' } });

    expect(targets()).toEqual(['bob-tab', 'bob-tab']);
  });

  it('is not CID-routed: the session it names (0 at sign-in) is no route at all', async () => {
    const { CID_ROUTED_NOTIFICATIONS } = await import('../routing-rules');
    expect(CID_ROUTED_NOTIFICATIONS.has('SecurityKeyChallengeNotification')).toBe(false);
  });
});
