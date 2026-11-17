/**
 * A session reopened in a new tab gets its answers there, even while the closed tab that
 * held it is still in the registry.
 *
 * Seen live: tab B (a follower holding erin's session) closed without its goodbye; an
 * account link reopened erin in tab C. Both entries named erin's CID, the first-registered
 * (B, dead) won, C's workspace answers were forwarded to B, timed out, and were processed
 * on the leader instead — the workspace never loaded.
 *
 * The registry is exercised directly (pure functions). For the router, the tab channel is
 * a recorder, because there are no other tabs here; the instance manager and the router
 * are the real ones.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findInstanceByCid, registerInstance, type InstanceRegistry } from '../instance-registry';

const forwarded: Array<{ to: string; type: string }> = vi.hoisted(() => []);
vi.mock('../instance-channel', () => ({
  instanceChannel: {
    forwardToInstance: (to: string, message: Record<string, unknown>): void => { forwarded.push({ to, type: Object.keys(message)[0] }); },
    requestCidReport: (): void => {},
    broadcast: (): void => {},
  },
}));

import { eventEmitter } from '@/lib/event-emitter';
import { instanceManager } from '../instance-manager';
import { instanceInboundRouter } from '../instance-inbound-router';
import { makeForwardFallback, type ForwardFallback } from '../router-forwarding';

const ERIN: bigint = 14741090851496596846n;

describe('the instance registry', () => {
  it('names the tab that registered a CID most recently', () => {
    const registry: InstanceRegistry = new Map();
    registerInstance(registry, 'closed-tab-B', ERIN);
    registerInstance(registry, 'new-tab-C', ERIN);
    expect(findInstanceByCid(registry, ERIN)).toBe('new-tab-C');
  });

  it('counts a re-registration as the most recent', () => {
    const registry: InstanceRegistry = new Map();
    registerInstance(registry, 'tab-B', ERIN);
    registerInstance(registry, 'tab-C', ERIN);
    registerInstance(registry, 'tab-B', ERIN);
    expect(findInstanceByCid(registry, ERIN)).toBe('tab-B');
  });

  it('still finds nobody for a CID nobody holds', () => {
    const registry: InstanceRegistry = new Map([['tab-B', 1n]]);
    expect(findInstanceByCid(registry, ERIN)).toBeNull();
  });
});

describe('the leader routing an answer for the reopened session', () => {
  beforeEach(() => {
    forwarded.length = 0;
    eventEmitter.emit('instance:leader-changed', { isLeader: true, leaderId: instanceManager.instanceId });
  });

  // Every tab holding a session receives what is addressed to it (several tabs
  // can be signed in to one account), so the new tab gets it. The closed tab's
  // silence then retires it without handing the message to anyone a second time.
  it('reaches the new tab, and the closed one\'s silence does not deliver it twice', () => {
    instanceManager.registerInstance('closed-tab-B', ERIN);
    instanceManager.registerInstance('new-tab-C', ERIN);
    const payload: string = JSON.stringify({ Response: { GetWorkspace: {} } });
    instanceInboundRouter.routeMessage({ MessageNotification: { cid: ERIN, peer_cid: 0n, request_id: null, message: Array.from(new TextEncoder().encode(payload)) } });
    expect(forwarded).toContainEqual({ to: 'new-tab-C', type: 'MessageNotification' });

    const rerouted: string[] = [];
    const fallback: ForwardFallback = makeForwardFallback(() => { throw new Error('not on the leader'); }, (_m, t): boolean => { rerouted.push(t); return true; });
    fallback({ MessageNotification: {} }, 'MessageNotification', 'closed-tab-B', ['closed-tab-B', 'new-tab-C']);
    expect(rerouted).toEqual([]);
    expect(instanceManager.findInstancesByCid(ERIN)).toEqual(['new-tab-C']);
  });
});

describe('a forward nobody acknowledged', () => {
  it('drops the silent tab and re-routes, rather than processing the answer on the leader', () => {
    const local: string[] = [];
    const rerouted: string[] = [];
    instanceManager.registerInstance('silent-tab', ERIN);
    const fallback: ForwardFallback = makeForwardFallback((m) => { local.push(Object.keys(m)[0]); }, (_m, type): boolean => { rerouted.push(type); return true; });
    fallback({ MessageNotification: {} }, 'MessageNotification', 'silent-tab');
    expect(rerouted).toEqual(['MessageNotification']);
    expect(local).toEqual([]);
    expect(instanceManager.getAllInstances().some((i) => i.instanceId === 'silent-tab')).toBe(false);
  });

  it('processes an unowned message locally, as before', () => {
    const local: string[] = [];
    const fallback: ForwardFallback = makeForwardFallback((m) => { local.push(Object.keys(m)[0]); }, (): boolean => { throw new Error('no reroute without a target'); });
    fallback({ GroupInviteNotification: {} }, 'GroupInviteNotification', undefined);
    expect(local).toEqual(['GroupInviteNotification']);
  });
});
