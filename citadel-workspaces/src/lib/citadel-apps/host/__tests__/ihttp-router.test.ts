/**
 * The internal-HTTP router's guards, each beside the control that shows the same frames pass when
 * the guard's condition is not met.
 */
import { describe, expect, it } from 'vitest';
import { IhttpRouter, type RouterAction } from '../ihttp-router';
import { parseRoutes, type ParsedRoutes } from '../ihttp-routes';
import type { Caller } from '../../sdk/generated/Caller';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import type { RequestHead } from '../../sdk/generated/RequestHead';
import { STANDARD_IHTTP_LIMITS } from '../limits';
import { RELAY_STREAM_BIT } from '../ihttp-wire';

const APP: string = 'com.acme.kanban';
const alice: Caller = { username: 'alice', cid: 11n, app_id: APP, install_id: 'i-1', via: 'p2p' };
const bob: Caller = { username: 'bob', cid: 12n, app_id: APP, install_id: 'i-1', via: 'relay' };

function router(): IhttpRouter {
  const r: IhttpRouter = new IhttpRouter(APP, STANDARD_IHTTP_LIMITS, null);
  const parsed: ParsedRoutes = parseRoutes([{ method: 'GET', path: '/cards/:id' }, { method: 'POST', path: '/upload/*' }], 64, 2048);
  if (!parsed.ok) throw new Error(parsed.reason);
  r.setRoutes(parsed.routes, { relay: true, p2p: true });
  return r;
}

const head = (path: string, over: Partial<RequestHead> = {}): RequestHead => ({
  method: 'GET', path, query: '', headers: [], body_len: 0n, app_id: APP, scope_key: 'ws', ...over,
});
const req = (stream: bigint, h: RequestHead): IhttpFrame => ({ v: 1, stream, kind: { RequestHead: h } });
const body = (stream: bigint, n: number): IhttpFrame => ({ v: 1, stream, kind: { Body: { bytes: new Uint8Array(n) } } });

const cancels = (actions: readonly RouterAction[]): string[] => actions.flatMap((a: RouterAction) =>
  a.kind === 'reply' && typeof a.frame.kind === 'object' && 'Cancel' in a.frame.kind ? [a.frame.kind.Cancel.reason] : []);
const delivered = (actions: readonly RouterAction[]): number => actions.filter((a: RouterAction) => a.kind === 'deliver').length;

describe('routes', () => {
  it('an advertised route reaches the app; an unadvertised one is cancelled', () => {
    const r: IhttpRouter = router();
    expect(delivered(r.inbound(alice, req(1n, head('/cards/7')), 0))).toBe(1);
    expect(cancels(r.inbound(alice, req(2n, head('/admin')), 0))).toEqual(['unrouted']);
    expect(cancels(r.inbound(alice, req(3n, head('/cards/7', { method: 'DELETE' })), 0))).toEqual(['unrouted']);
  });

  it('nothing is routed before the app advertises', () => {
    const r: IhttpRouter = new IhttpRouter(APP, STANDARD_IHTTP_LIMITS, null);
    expect(cancels(r.inbound(alice, req(1n, head('/cards/7')), 0))).toEqual(['unrouted']);
  });

  it('a request for another app id is refused (control: this app id passes)', () => {
    const r: IhttpRouter = router();
    expect(cancels(r.inbound(alice, req(1n, head('/cards/1', { app_id: 'com.evil.app' })), 0))).toEqual(['wrong_app']);
    expect(cancels(r.inbound(alice, req(2n, head('/cards/1')), 0))).toEqual([]);
  });

  it('dot segments never match a pattern', () => {
    expect(cancels(router().inbound(alice, req(1n, head('/cards/..')), 0))).toEqual(['unrouted']);
  });

  it('malformed route tables are refused at serve', () => {
    expect(parseRoutes([{ method: 'GET', path: 'no-slash' }], 64, 2048).ok).toBe(false);
    expect(parseRoutes([{ method: 'TRACE', path: '/x' }], 64, 2048).ok).toBe(false);
    expect(parseRoutes([{ method: 'GET', path: '/*/x' }], 64, 2048).ok).toBe(false);
    expect(parseRoutes(Array.from({ length: 65 }, (_, i: number) => ({ method: 'GET', path: `/r${i}` })), 64, 2048).ok).toBe(false);
    expect(parseRoutes(Array.from({ length: 64 }, (_, i: number) => ({ method: 'GET', path: `/r${i}` })), 64, 2048).ok).toBe(true);
  });
});

describe('stream limits', () => {
  it('a caller gets 8 concurrent streams, the 9th is cancelled; another caller is unaffected', () => {
    const r: IhttpRouter = router();
    for (let i: number = 1; i <= 8; i++) expect(cancels(r.inbound(alice, req(BigInt(i), head(`/cards/${i}`)), i * 40))).toEqual([]);
    expect(cancels(r.inbound(alice, req(9n, head('/cards/9')), 400))).toEqual(['caller_concurrency']);
    expect(cancels(r.inbound(bob, req(1n, head('/cards/1')), 400))).toEqual([]);
  });

  it('a relayed call does not make the same caller’s later P2P ids a step back (control: on one plane they are)', () => {
    // The relay numbers streams from RELAY_STREAM_BIT up; the caller numbers its own P2P ones from 1.
    const r: IhttpRouter = router();
    const viaRelay: Caller = { ...alice, via: 'relay' };
    expect(cancels(r.inbound(viaRelay, req(RELAY_STREAM_BIT | 1n, head('/cards/1')), 0))).toEqual([]);
    expect(cancels(r.inbound(alice, req(3n, head('/cards/2')), 0))).toEqual([]);
    expect(cancels(r.inbound(viaRelay, req(RELAY_STREAM_BIT, head('/cards/3')), 0))).toEqual(['stream_id']);
    expect(cancels(r.inbound(alice, req(2n, head('/cards/4')), 0))).toEqual(['stream_id']);
  });

  it('stream ids must increase per caller; the open stream’s own head again is dropped, not answered (E8)', () => {
    const r: IhttpRouter = router();
    r.inbound(alice, req(5n, head('/cards/1')), 0);
    expect(r.inbound(alice, req(5n, head('/cards/2')), 0)).toEqual([]);
    expect(cancels(r.inbound(alice, req(4n, head('/cards/2')), 0))).toEqual(['stream_id']);
    expect(cancels(r.inbound(alice, req(6n, head('/cards/2')), 0))).toEqual([]);
  });

  it('30 requests per second per caller: the 31st within the second is cancelled', () => {
    const r: IhttpRouter = router();
    for (let i: number = 1; i <= 30; i++) {
      r.inbound(alice, req(BigInt(i), head(`/cards/${i}`)), 0);
      r.respond(alice, { v: 1, stream: BigInt(i), kind: { Cancel: { reason: 'done' } } }, 0);
    }
    expect(cancels(r.inbound(alice, req(31n, head('/cards/31')), 0))).toEqual(['rate']);
    expect(cancels(r.inbound(alice, req(32n, head('/cards/32')), 1000))).toEqual([]);
  });

  it('a stream past its deadline is cancelled both ways', () => {
    const r: IhttpRouter = router();
    r.inbound(alice, req(1n, head('/cards/1')), 0);
    expect(r.tick(STANDARD_IHTTP_LIMITS.streamTimeoutMs - 1)).toEqual([]);
    const out: RouterAction[] = r.tick(STANDARD_IHTTP_LIMITS.streamTimeoutMs);
    expect(cancels(out)).toEqual(['timeout']);
    expect(delivered(out)).toBe(1);
    expect(r.liveStreams).toBe(0);
  });
});

describe('bodies and flow control', () => {
  const upload = (r: IhttpRouter, bodyLen: bigint | null): void => {
    expect(cancels(r.inbound(alice, req(1n, head('/upload/a', { method: 'POST', body_len: bodyLen })), 0))).toEqual([]);
  };

  it('a request body over 4 MiB is cut with Cancel (control: exactly 4 MiB passes)', () => {
    const chunk: number = STANDARD_IHTTP_LIMITS.maxChunkBytes;
    const chunks: number = STANDARD_IHTTP_LIMITS.maxRequestBodyBytes / chunk;
    for (const extra of [0, 1]) {
      const r: IhttpRouter = router();
      upload(r, null);
      let seen: string[] = [];
      for (let i: number = 0; i < chunks; i++) {
        seen = seen.concat(cancels(r.inbound(alice, body(1n, chunk), 0)));
        seen = seen.concat(cancels(r.consumed(alice, 1n, 0).actions));
      }
      if (extra > 0) seen = seen.concat(cancels(r.inbound(alice, body(1n, extra), 0)));
      expect(seen).toEqual(extra > 0 ? ['request_body_too_large'] : []);
    }
  });

  it('a declared body over 4 MiB is refused at the head', () => {
    const r: IhttpRouter = router();
    const tooBig: bigint = BigInt(STANDARD_IHTTP_LIMITS.maxRequestBodyBytes + 1);
    expect(cancels(r.inbound(alice, req(1n, head('/upload/a', { method: 'POST', body_len: tooBig })), 0))).toEqual(['request_body_too_large']);
  });

  it('a caller sending past its credit is cancelled (control: within credit passes)', () => {
    const r: IhttpRouter = router();
    upload(r, null);
    for (let i: number = 0; i < STANDARD_IHTTP_LIMITS.initialCredit; i++) expect(cancels(r.inbound(alice, body(1n, 10), 0))).toEqual([]);
    expect(cancels(r.inbound(alice, body(1n, 10), 0))).toEqual(['credit']);
  });

  it('a chunk over 64 KiB is cancelled', () => {
    const r: IhttpRouter = router();
    upload(r, null);
    expect(cancels(r.inbound(alice, body(1n, STANDARD_IHTTP_LIMITS.maxChunkBytes + 1), 0))).toEqual(['chunk_too_large']);
  });

  it('the app cannot send response bodies past the caller credit, nor past 16 MiB', () => {
    const r: IhttpRouter = router();
    r.inbound(alice, req(1n, head('/cards/1')), 0);
    expect(r.respond(alice, { v: 1, stream: 1n, kind: { Body: { bytes: new Uint8Array(1) } } }, 0).ok).toBe(false);
    expect(r.respond(alice, { v: 1, stream: 1n, kind: { ResponseHead: { status: 200, headers: [], body_len: null } } }, 0).ok).toBe(true);
    for (let i: number = 0; i < STANDARD_IHTTP_LIMITS.initialCredit; i++) {
      expect(r.respond(alice, { v: 1, stream: 1n, kind: { Body: { bytes: new Uint8Array(1) } } }, 0).ok).toBe(true);
    }
    expect(r.respond(alice, { v: 1, stream: 1n, kind: { Body: { bytes: new Uint8Array(1) } } }, 0)).toMatchObject({ ok: false, refused: { limit: 'credit' } });
    r.inbound(alice, { v: 1, stream: 1n, kind: { Credit: { n: 1 } } }, 0);
    expect(r.respond(alice, { v: 1, stream: 1n, kind: { Body: { bytes: new Uint8Array(1) } } }, 0).ok).toBe(true);
    const big: IhttpFrame = { v: 1, stream: 1n, kind: { ResponseHead: { status: 200, headers: [], body_len: BigInt(STANDARD_IHTTP_LIMITS.maxResponseBodyBytes + 1) } } };
    r.inbound(alice, req(2n, head('/cards/2')), 0);
    expect(r.respond(alice, { ...big, stream: 2n }, 0)).toMatchObject({ ok: false, refused: { limit: 'response_body' } });
  });

  it('too many or too large headers are refused at the head', () => {
    const r: IhttpRouter = router();
    const many: [string, string][] = Array.from({ length: 33 }, (_, i: number): [string, string] => [`h${i}`, 'v']);
    expect(cancels(r.inbound(alice, req(1n, head('/cards/1', { headers: many })), 0))).toEqual(['too_many_headers']);
    expect(cancels(r.inbound(alice, req(2n, head('/cards/1', { headers: [['x', 'v'.repeat(1024)]] })), 0))).toEqual(['header_too_large']);
    expect(cancels(r.inbound(alice, req(3n, head('/cards/1', { headers: many.slice(0, 32) })), 0))).toEqual([]);
  });
});
