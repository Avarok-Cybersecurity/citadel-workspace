/**
 * Several tabs of one browser signed in to the same account all receive what
 * is addressed to it: every ConversationEvent, message, ring, transfer and
 * path change for that CID, once each. An answer still goes only to the tab
 * that asked, and a tab on another account gets none of it.
 *
 * The router and the instance manager are the real ones, with this tab as the
 * leader; the tab channel is a recorder, as there are no other tabs here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const forwarded: Array<{ to: string; type: string }> = vi.hoisted(() => []);
const unacked: string[] = vi.hoisted(() => []);
vi.mock('../instance-channel', () => ({
  instanceChannel: {
    forwardToInstance: (to: string, message: Record<string, unknown>, requestId?: string): void => {
      forwarded.push({ to, type: Object.keys(message)[0] });
      if (requestId) unacked.push(requestId);
    },
    requestCidReport: (): void => {},
    broadcast: (): void => {},
  },
}));

import { eventEmitter } from '@/lib/event-emitter';
import { instanceManager } from '../instance-manager';
import { instanceInboundRouter } from '../instance-inbound-router';
import { markP2PMessageHandlerAttached } from '@/lib/p2p/p2p-handler-ready';

const ALICE: bigint = 1001n;
const BOB: bigint = 2002n;
let here: string[] = [];

beforeEach(() => {
  // The other tabs acknowledged what they were sent, as live tabs do.
  for (const requestId of unacked.splice(0)) eventEmitter.emit('channel:inbound-ack', { requestId });
  forwarded.length = 0;
  here = [];
  for (const i of instanceManager.getAllInstances()) instanceManager.unregisterInstance(i.instanceId);
  eventEmitter.emit('instance:leader-changed', { isLeader: true, leaderId: instanceManager.instanceId });
  instanceManager.registerInstance(instanceManager.instanceId, ALICE);
  instanceManager.registerInstance('alice-second-tab', ALICE);
  instanceManager.registerInstance('bob-tab', BOB);
});

markP2PMessageHandlerAttached();
eventEmitter.on('websocket-message', (m: Record<string, unknown>) => { here.push(Object.keys(m)[0]); });

const event = (cid: bigint): Record<string, unknown> => ({
  ConversationEvent: { cid, peer_cid: BOB, seq: 1n, kind: 'Appended', message: null, message_id: 'm1', metadata: null, account_username: 'alice', peer_username: 'bob', preview: '', request_id: null },
});

describe('two tabs on one account', () => {
  it('both receive a conversation event, once each, and the other account\'s tab does not', () => {
    instanceInboundRouter.routeMessage(event(ALICE));
    expect(here).toEqual(['ConversationEvent']);
    expect(forwarded).toEqual([{ to: 'alice-second-tab', type: 'ConversationEvent' }]);
  });

  it('both receive a peer\'s message and a call ring', () => {
    instanceInboundRouter.routeMessage({ MessageNotification: { cid: ALICE, peer_cid: BOB, message: [1], request_id: 'bobs-send' } });
    instanceInboundRouter.routeMessage({ MediaFrameNotification: { cid: ALICE, peer_cid: BOB, track: 1, kind: 1, sequence: 1, timestamp: 0, flags: 1, payload: [1], request_id: null } });
    expect(here).toEqual(['MessageNotification', 'MediaFrameNotification']);
    expect(forwarded).toEqual([
      { to: 'alice-second-tab', type: 'MessageNotification' },
      { to: 'alice-second-tab', type: 'MediaFrameNotification' },
    ]);
  });

  it('even when the send that caused the event was the second tab\'s: the event is not its answer', () => {
    instanceInboundRouter.registerPendingRequest('send-1', 'alice-second-tab');
    const own: Record<string, unknown> = event(ALICE);
    (own.ConversationEvent as Record<string, unknown>).request_id = 'send-1';
    instanceInboundRouter.routeMessage(own);
    expect(here).toEqual(['ConversationEvent']);
    // ...and the answer to that send still reaches the second tab alone.
    instanceInboundRouter.routeMessage({ ConversationUpdated: { cid: ALICE, peer_cid: BOB, message: null, request_id: 'send-1' } });
    expect(here).toEqual(['ConversationEvent']);
    expect(forwarded).toEqual([
      { to: 'alice-second-tab', type: 'ConversationEvent' },
      { to: 'alice-second-tab', type: 'ConversationUpdated' },
    ]);
  });
});
