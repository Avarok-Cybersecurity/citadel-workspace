/**
 * An apps answer from the workspace server -- `Uninstalled`, say -- reaches every tab of the
 * account that asked, not only the one that asked: the server tells the caller once and sends
 * other members `InstallsChanged` instead (kernel/command_processor/apps_notice.rs), so a second
 * tab of the same account hears of the uninstall only through this frame. It arrives as a
 * MessageNotification whose request_id is the session's spent Connect id (c2s_reader.rs), so it
 * is routed by cid, to every tab holding the session; each tab's handler then emits
 * `workspace:apps`, which drops the app's tab (office/tabs/__tests__/an-uninstalled-apps-tab-
 * goes-away.test.tsx). A tab on another account is not handed it.
 *
 * The router and instance manager are the real ones, with this tab as the leader; the tab channel
 * is a recorder, as there are no other tabs here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const forwarded: Array<{ to: string; message: Record<string, unknown> }> = vi.hoisted(() => []);
vi.mock('../instance-channel', () => ({
  instanceChannel: {
    forwardToInstance: (to: string, message: Record<string, unknown>): void => { forwarded.push({ to, message }); },
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
const here: Array<Record<string, unknown>> = [];

markP2PMessageHandlerAttached();
eventEmitter.on('websocket-message', (m: Record<string, unknown>) => { here.push(m); });

beforeEach(() => {
  forwarded.length = 0;
  here.length = 0;
  for (const i of instanceManager.getAllInstances()) instanceManager.unregisterInstance(i.instanceId);
  eventEmitter.emit('instance:leader-changed', { isLeader: true, leaderId: instanceManager.instanceId });
  instanceManager.registerInstance(instanceManager.instanceId, ALICE);
  instanceManager.registerInstance('alice-second-tab', ALICE);
  instanceManager.registerInstance('bob-tab', BOB);
});

const uninstalled = (cid: bigint): Record<string, unknown> => ({
  MessageNotification: { cid, peer_cid: 0n, message: Array.from(new TextEncoder().encode('{"Apps":{"Uninstalled":{"install_id":"i1"}}}')), request_id: 'alices-connect' },
});

describe('an apps answer for one account', () => {
  it('reaches this tab and the account\'s second tab, the same frame, and not the other account\'s', () => {
    const frame: Record<string, unknown> = uninstalled(ALICE);
    expect(instanceInboundRouter.routeMessage(frame)).toBe(true);
    expect(here).toEqual([frame]);
    expect(forwarded.map((f) => f.to)).toEqual(['alice-second-tab']);
    expect(forwarded[0].message).toEqual(frame);
  });

});
