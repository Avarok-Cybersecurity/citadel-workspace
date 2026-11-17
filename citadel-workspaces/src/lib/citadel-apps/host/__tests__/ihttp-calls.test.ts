/**
 * Calls this instance makes (IhttpCall), and the stream-id DECISION: frames carry no direction
 * bit, so the router scopes ids per (peer, direction) and never lets a served stream and a call
 * share an id with the same app. Each guard sits beside its control.
 */
import { describe, expect, it } from 'vitest';
import type { Address } from '../../sdk/generated/Address';
import type { Caller } from '../../sdk/generated/Caller';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import type { RequestHead } from '../../sdk/generated/RequestHead';
import { IhttpRouter, type ClosingAction, type RouterAction } from '../ihttp-router';
import { parseRoutes, type ParsedRoutes } from '../ihttp-routes';
import { STANDARD_IHTTP_LIMITS } from '../limits';

const APP: string = 'com.acme.kanban';
const bob: Caller = { username: 'bob', cid: 12n, app_id: APP, install_id: 'i-2', via: 'p2p' };
const toBob: Address = { user: { app_id: APP, username: 'bob' } };

function router(): IhttpRouter {
  const r: IhttpRouter = new IhttpRouter(APP, STANDARD_IHTTP_LIMITS, null);
  const parsed: ParsedRoutes = parseRoutes([{ method: 'GET', path: '/cards/:id' }, { method: 'POST', path: '/upload/*' }], 64, 2048);
  if (!parsed.ok) throw new Error(parsed.reason);
  r.setRoutes(parsed.routes, { relay: true, p2p: true });
  return r;
}

const head = (path: string, method: RequestHead['method'] = 'GET'): RequestHead => ({
  method, path, query: '', headers: [], body_len: null, app_id: APP, scope_key: 'ws',
});
const f = (stream: bigint, kind: IhttpFrame['kind']): IhttpFrame => ({ v: 1, stream, kind });
const request = (stream: bigint, path: string, method: RequestHead['method'] = 'GET'): IhttpFrame => f(stream, { RequestHead: head(path, method) });
const response = (stream: bigint): IhttpFrame => f(stream, { ResponseHead: { status: 200, headers: [], body_len: null } });
const body = (stream: bigint): IhttpFrame => f(stream, { Body: { bytes: new Uint8Array(3) } });

const kinds = (actions: readonly RouterAction[]): string[] => actions.map((a: RouterAction) => {
  const k: IhttpFrame['kind'] = a.frame.kind;
  return `${a.kind}:${typeof k === 'string' ? k : Object.keys(k)[0]}`;
});

describe('calls', () => {
  it('a call opens, its response is delivered, consumed grants the server credit, End closes it', () => {
    const r: IhttpRouter = router();
    expect(r.call(toBob, request(1n, '/cards/1'), 'p2p', 0)).toEqual({ ok: true, actions: [] });
    expect(kinds(r.inbound(bob, response(1n), 0))).toEqual(['deliver:ResponseHead']);
    expect(kinds(r.inbound(bob, body(1n), 0))).toEqual(['deliver:Body']);
    expect(kinds(r.consumed(bob, 1n, 0).actions)).toEqual(['reply:Credit']);
    expect(kinds(r.inbound(bob, f(1n, 'End'), 0))).toEqual(['deliver:End']);
    expect(r.liveStreams).toBe(0);
    expect(r.consumed(bob, 1n, 0)).toMatchObject({ ok: false, refused: { policy: 'unknown_stream' } });
  });

  it('a server sending past the credit the app granted is cut (control: after consumed it passes)', () => {
    const r: IhttpRouter = router();
    r.call(toBob, request(1n, '/cards/1'), 'p2p', 0);
    r.inbound(bob, response(1n), 0);
    for (let i: number = 0; i < STANDARD_IHTTP_LIMITS.initialCredit; i++) expect(kinds(r.inbound(bob, body(1n), 0))).toEqual(['deliver:Body']);
    r.consumed(bob, 1n, 0);
    expect(kinds(r.inbound(bob, body(1n), 0))).toEqual(['deliver:Body']);
    expect(kinds(r.inbound(bob, body(1n), 0))).toEqual(['reply:Cancel', 'deliver:Cancel']);
  });

  it('a call must name the app it addresses, use rising ids, and stay under 8 live calls', () => {
    const r: IhttpRouter = router();
    expect(r.call(toBob, f(1n, { RequestHead: { ...head('/x'), app_id: 'com.other' } }), 'p2p', 0)).toMatchObject({ ok: false, refused: { policy: 'wrong_app' } });
    for (let i: number = 1; i <= 8; i++) expect(r.call(toBob, request(BigInt(i), '/x'), 'p2p', 0).ok).toBe(true);
    expect(r.call(toBob, request(9n, '/x'), 'p2p', 0)).toMatchObject({ ok: false, refused: { limit: 'calls' } });
    expect(r.call(toBob, request(3n, '/x'), 'p2p', 0)).toMatchObject({ ok: false, refused: { policy: 'stream_id' } });
  });
});

describe('stream ids are scoped per (peer, direction)', () => {
  it('a served stream and a call never share an id with the same app (control: a fresh id passes)', () => {
    const r: IhttpRouter = router();
    expect(kinds(r.inbound(bob, request(1n, '/cards/1'), 0))).toEqual(['deliver:RequestHead']);
    expect(r.call(toBob, request(1n, '/cards/9'), 'p2p', 0)).toMatchObject({ ok: false, refused: { policy: 'stream_id_in_use' } });
    expect(r.call(toBob, request(2n, '/cards/9'), 'p2p', 0).ok).toBe(true);
    expect(kinds(r.inbound(bob, request(2n, '/cards/2'), 0))).toEqual(['reply:Cancel']);
    expect(kinds(r.inbound(bob, request(3n, '/cards/3'), 0))).toEqual(['deliver:RequestHead']);
  });

  it('each inbound frame reaches its own direction: a served upload and a call, side by side', () => {
    const r: IhttpRouter = router();
    r.inbound(bob, request(1n, '/upload/a', 'POST'), 0);
    r.call(toBob, request(2n, '/cards/1'), 'p2p', 0);
    expect(kinds(r.inbound(bob, response(2n), 0))).toEqual(['deliver:ResponseHead']);
    expect(kinds(r.inbound(bob, body(1n), 0))).toEqual(['deliver:Body']);
    expect(r.respond(bob, response(1n), 0).ok).toBe(true);
    expect(r.respond(bob, response(2n), 0)).toMatchObject({ ok: false });
    expect(kinds(r.inbound(bob, f(2n, 'End'), 0))).toEqual(['deliver:End']);
    expect(r.liveStreams).toBe(1);
  });
});

describe('one credit path: the host mints every Credit, from IhttpConsumed only', () => {
  const credit = (stream: bigint): IhttpFrame => f(stream, { Credit: { n: 1 } });

  it('an app cannot send a Credit frame on a call or on a stream it serves (control: IhttpConsumed mints one)', () => {
    const r: IhttpRouter = router();
    r.call(toBob, request(1n, '/cards/1'), 'p2p', 0);
    r.inbound(bob, response(1n), 0);
    expect(r.call(toBob, credit(1n), 'p2p', 0)).toMatchObject({ ok: false, refused: { policy: 'credit_is_granted_by_the_host' } });
    r.inbound(bob, request(2n, '/upload/a', 'POST'), 0);
    expect(r.respond(bob, credit(2n), 0)).toMatchObject({ ok: false, refused: { policy: 'credit_is_granted_by_the_host' } });
    expect(kinds(r.consumed(bob, 1n, 0).actions)).toEqual(['reply:Credit']);
    expect(kinds(r.consumed(bob, 2n, 0).actions)).toEqual(['reply:Credit']);
  });
});

describe('closing the instance', () => {
  it('cancels every stream both ways as `closed`: each caller it serves, and each call on the address it was made to', () => {
    const r: IhttpRouter = router();
    const carol: Caller = { ...bob, username: 'carol', cid: 13n, install_id: 'i-3' };
    expect(kinds(r.inbound(carol, request(5n, '/cards/2'), 0))).toEqual(['deliver:RequestHead']);
    expect(r.call(toBob, request(1n, '/cards/1'), 'p2p', 0).ok).toBe(true);
    expect(r.call(toBob, request(2n, '/cards/2'), 'p2p', 0).ok).toBe(true);
    expect(kinds(r.inbound(bob, response(2n), 0))).toEqual(['deliver:ResponseHead']);
    const closing: ClosingAction[] = r.closeAll();
    expect(closing).toEqual([
      { kind: 'reply', peer: carol, frame: f(5n, { Cancel: { reason: 'closed' } }) },
      { kind: 'call', to: toBob, transport: 'p2p', frame: f(1n, { Cancel: { reason: 'closed' } }) },
      { kind: 'call', to: toBob, transport: 'p2p', frame: f(2n, { Cancel: { reason: 'closed' } }) },
    ]);
    expect(r.liveStreams).toBe(0);
    // Nothing is served after: the advertised table went with it.
    expect(r.inbound(carol, request(6n, '/cards/3'), 0).map((a: RouterAction) => a.frame.kind)).toEqual([{ Cancel: { reason: 'unrouted' } }]);
    // Control: a second close has nothing left to cancel.
    expect(r.closeAll()).toEqual([]);
  });
});
