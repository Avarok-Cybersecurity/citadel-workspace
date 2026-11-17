/**
 * A media frame crosses the leader's inbound path without a debug line.
 *
 * Frames arrive 30-60 times a second per track, per participant. Each one used to print six
 * lines on the way in (received, routeMessage, uses CID routing, Routing, emit listeners,
 * Skipping legacy broadcast), and debugLog redacts its arguments, so the whole frame, payload
 * and all, was walked and printed for every one: ~420 console lines a second per page in CI's
 * three-way call, with Playwright serialising each. Delivery is what must not change, so the
 * frames are counted at the bus as well, and a low-rate message is still logged.
 *
 * Mocked: the instance channel and manager (module singletons that open a BroadcastChannel and
 * run an election), as in instance-inbound-router-self-heal.test.ts, and the legacy broadcast
 * service, for the same reason. The handler and the whole router run for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const LEADER: string = 'leader-instance';
const OWN_CID: bigint = 5n;

vi.mock('../../multi-instance/instance-channel', () => ({
  instanceChannel: { requestCidReport: vi.fn(), forwardToInstance: vi.fn(), broadcast: vi.fn() },
}));
vi.mock('../../multi-instance/instance-manager', () => ({
  instanceManager: {
    instanceId: 'leader-instance', isLeader: true,
    findInstanceByCid: (): string => 'leader-instance',
    findInstancesByCid: (): string[] => ['leader-instance'],
    getAllInstances: (): Array<{ instanceId: string; cid: bigint }> => [{ instanceId: 'leader-instance', cid: 5n }],
    registerInstance: vi.fn(),
  },
}));
vi.mock('../../broadcast-channel-service', () => ({
  broadcastChannelService: { getIsLeader: (): boolean => true, broadcastWorkspaceResponse: vi.fn() },
}));

import { eventEmitter } from '../../event-emitter';
import { leaderInboundHandler } from '../leader-inbound-handler';
import type { InternalServiceResponse } from 'citadel-workspace-client-ts';

function frame(n: number): InternalServiceResponse {
  return {
    MediaFrameNotification: { cid: OWN_CID, peer_cid: 6n, track: 1, kind: 1, timestamp: n, flags: 0, payload: Array.from({ length: 512 }, (_: unknown, i: number): number => i % 256) },
  } as unknown as InternalServiceResponse;
}

let lines: string[] = [];
beforeEach((): void => {
  lines = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]): void => { lines.push(args.map(String).join(' ')); });
  eventEmitter.emit('instance:leader-changed', { isLeader: true, leaderId: LEADER });
});
afterEach((): void => { vi.restoreAllMocks(); });

describe('the leader inbound path at frame rate', () => {
  it('delivers every frame and prints nothing for any of them', () => {
    const delivered: unknown[] = [];
    const off: () => void = eventEmitter.on('websocket-message', (m: unknown): void => { if (m && typeof m === 'object' && 'MediaFrameNotification' in m) delivered.push(m); });
    const handle: (m: InternalServiceResponse) => void = leaderInboundHandler();
    lines = [];
    for (let i: number = 0; i < 60; i += 1) handle(frame(i));
    off();
    expect(delivered).toHaveLength(60);
    expect(lines.filter((l: string): boolean => l.includes('MediaFrameNotification'))).toEqual([]);
  });

  it('still logs a message that is not a frame', () => {
    const handle: (m: InternalServiceResponse) => void = leaderInboundHandler();
    lines = [];
    handle({ MediaGapNotification: { cid: OWN_CID, peer_cid: 6n, track: 1 } } as unknown as InternalServiceResponse);
    expect(lines.filter((l: string): boolean => l.includes('MediaGapNotification')).length).toBeGreaterThan(0);
  });
});
