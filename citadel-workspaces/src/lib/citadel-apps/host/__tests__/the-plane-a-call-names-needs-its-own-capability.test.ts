/**
 * The ihttp ops admit either plane's capability; the plane a call names needs its own. A P2P call
 * from an install holding only the relay capability is `ungranted` (and so is a relay call holding
 * only P2P), `prefer_p2p_then_relay` starts on whichever plane is held and falls back only to a
 * held relay, and a stream that arrives on a plane the app does not serve on is `unrouted`.
 */
import { describe, expect, it } from 'vitest';
import type { Capability } from '../capabilities';
import type { Caller } from '../../sdk/generated/Caller';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import { callPlan, servePlan, servesVia } from '../ihttp-planes';
import { IhttpRouter, type RouterAction } from '../ihttp-router';
import { parseRoutes, type ParsedRoutes } from '../ihttp-routes';
import { STANDARD_IHTTP_LIMITS } from '../limits';
import { findOp, type OpEntry } from '../ops';

const held = (...caps: Capability[]): ReadonlySet<Capability> => new Set<Capability>(caps);
const ihttpCall: OpEntry = findOp('ihttp', 3) as OpEntry;
const ihttpServe: OpEntry = findOp('ihttp', 1) as OpEntry;

describe('a call’s plane', () => {
  it('p2p needs ihttp.p2p.call and relay needs ihttp.call (control: each admitted with its own)', () => {
    expect(ihttpCall.name).toBe('IhttpCall');
    expect(ihttpCall.admits({ transport: 'p2p' }, held('ihttp.call'))).toBe(false);
    expect(ihttpCall.admits({ transport: 'p2p' }, held('ihttp.p2p.call'))).toBe(true);
    expect(ihttpCall.admits({ transport: 'relay' }, held('ihttp.p2p.call'))).toBe(false);
    expect(ihttpCall.admits({ transport: 'relay' }, held('ihttp.call'))).toBe(true);
  });

  it('prefer_p2p_then_relay starts on P2P and falls back only to a held relay', () => {
    expect(callPlan('prefer_p2p_then_relay', held('ihttp.p2p.call', 'ihttp.call'))).toEqual({ first: 'p2p', fallback: 'relay' });
    expect(callPlan('prefer_p2p_then_relay', held('ihttp.p2p.call'))).toEqual({ first: 'p2p', fallback: null });
    expect(callPlan('prefer_p2p_then_relay', held('ihttp.call'))).toEqual({ first: 'relay', fallback: null });
    expect(callPlan('prefer_p2p_then_relay', held())).toBeNull();
    expect(callPlan('p2p', held('ihttp.p2p.call', 'ihttp.call'))).toEqual({ first: 'p2p', fallback: null });
  });
});

describe('an advertisement’s planes', () => {
  it('advertises the held planes, says when one asked for is not held, and admits none held as nothing', () => {
    expect(servePlan({ relay: true, p2p: true }, held('ihttp.serve'))).toEqual({ kind: 'serve', on: { relay: true, p2p: false }, partial: true });
    expect(servePlan({ relay: false, p2p: true }, held('ihttp.p2p.serve'))).toEqual({ kind: 'serve', on: { relay: false, p2p: true }, partial: false });
    expect(servePlan({ relay: false, p2p: true }, held('ihttp.serve'))).toEqual({ kind: 'ungranted' });
    expect(servePlan({ relay: false, p2p: false }, held('ihttp.serve'))).toEqual({ kind: 'none_requested' });
    expect(ihttpServe.admits({ on: { relay: false, p2p: true } }, held('ihttp.serve'))).toBe(false);
    expect(ihttpServe.admits({ on: { relay: false, p2p: true } }, held('ihttp.p2p.serve'))).toBe(true);
  });

  it('a topic sender is never an internal-HTTP caller', () => {
    expect(servesVia({ relay: true, p2p: true }, 'group')).toBe(false);
  });
});

describe('the router serves only the planes it was told', () => {
  const APP: string = 'com.acme.pool';
  const peer = (via: Caller['via']): Caller => ({ username: 'bob', cid: 9n, app_id: APP, install_id: 'i', via });
  const head = (stream: bigint): IhttpFrame => ({ v: 1, stream, kind: { RequestHead: { method: 'GET', path: '/health', query: '', headers: [], body_len: 0n, app_id: APP, scope_key: 'ws' } } });
  const kindOf = (a: readonly RouterAction[]): unknown => a.map((x: RouterAction) => x.frame.kind);

  it('a P2P request to a relay-only server is unrouted (control: the same request over the relay is delivered)', () => {
    const r: IhttpRouter = new IhttpRouter(APP, STANDARD_IHTTP_LIMITS, null);
    const parsed: ParsedRoutes = parseRoutes([{ method: 'GET', path: '/health' }], 64, 2048);
    if (!parsed.ok) throw new Error(parsed.reason);
    r.setRoutes(parsed.routes, { relay: true, p2p: false });
    expect(kindOf(r.inbound(peer('p2p'), head(1n), 0))).toEqual([{ Cancel: { reason: 'unrouted' } }]);
    expect(r.inbound(peer('relay'), head(2n), 0).map((a: RouterAction) => a.kind)).toEqual(['deliver']);
  });

  it('a later frame of a call may not switch transport', () => {
    const r: IhttpRouter = new IhttpRouter(APP, STANDARD_IHTTP_LIMITS, null);
    const to = { user: { app_id: APP, username: 'bob' } } as const;
    expect(r.call(to, head(1n), 'p2p', 0).ok).toBe(true);
    expect(r.call(to, { v: 1, stream: 1n, kind: 'End' }, 'relay', 0)).toMatchObject({ ok: false, refused: { policy: 'transport' } });
    expect(r.call(to, { v: 1, stream: 1n, kind: 'End' }, 'p2p', 0).ok).toBe(true);
  });
});
