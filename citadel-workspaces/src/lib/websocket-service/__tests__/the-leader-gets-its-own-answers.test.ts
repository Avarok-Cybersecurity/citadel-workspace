/**
 * An answer to a request the leader sent comes back to the leader, whatever session it names.
 *
 * Seen on the live site: the leader claimed a follower tab's session on its new connection,
 * the agent answered `ConnectionManagementSuccess { cid: <follower's> }`, and — the leader's
 * own request id never having been tracked — the router fell back to CID routing and handed
 * the answer to the follower. The leader timed out on a claim that had succeeded, reported
 * it as failed, and retried.
 *
 * Mocked, because neither exists without a browser and an agent: the instance manager
 * (which tab leads, and who owns which CID) and the WebSocket client (a recorder). The
 * router and sendRequest are the real ones.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const FOLLOWER_CID: bigint = 42n;
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, {
    isLeader: true,
    instanceId: 'leader-tab',
    leaderId: 'leader-tab',
    findInstanceByCid: (cid: bigint): string | null => (cid === FOLLOWER_CID ? 'follower-tab' : null),
    findInstancesByCid: (cid: bigint): string[] => (cid === FOLLOWER_CID ? ['follower-tab'] : []),
    registerInstance: (): void => {},
  }) };
});

import { eventEmitter } from '@/lib/event-emitter';
import { instanceInboundRouter } from '@/lib/multi-instance';
import { sendRequest } from '../send-request';
import type { WebSocketServiceCore } from '../core';

const sent: unknown[] = [];
const service: WebSocketServiceCore = {
  init: async (): Promise<void> => {},
  client: { sendDirectToInternalService: async (r: unknown): Promise<void> => { sent.push(r); } },
} as unknown as WebSocketServiceCore;

beforeEach(() => {
  sent.length = 0;
  eventEmitter.emit('instance:leader-changed', { isLeader: true, leaderId: 'leader-tab' });
});

describe('the leader sending a request', () => {
  it('receives the answer itself even when it names a follower tab session', async () => {
    const requestId: string = crypto.randomUUID();
    await sendRequest(service, {
      ConnectionManagement: { request_id: requestId, management_command: { ClaimSession: { session_cid: FOLLOWER_CID, only_if_orphaned: true } } },
    });
    expect(sent).toHaveLength(1);

    const local: unknown[] = [];
    const onLocal = (m: unknown): void => { local.push(m); };
    eventEmitter.on('websocket-message', onLocal);
    const answer: Record<string, unknown> = { ConnectionManagementSuccess: { request_id: requestId, cid: FOLLOWER_CID, message: 'claimed' } };
    try {
      instanceInboundRouter.routeMessage(answer);
    } finally {
      eventEmitter.off('websocket-message', onLocal);
    }
    expect(local).toEqual([answer]);
  });
});
