/**
 * `limits.p2p` held by the host (S14): the manifest's `max_response_bytes` caps a response on a
 * P2P stream, served or called, and its `max_fanout_concurrency` the calls that may go P2P at
 * once. The relay is held to the page's limits only. The router and instanceLimits are the
 * production ones; each cap is shown at its edge, one byte or one call either side.
 */
import { describe, expect, it } from 'vitest';
import type { Address } from '../../sdk/generated/Address';
import type { Caller } from '../../sdk/generated/Caller';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import type { Transport } from '../../sdk/generated/Transport';
import { IhttpRouter, type RouterAction, type Verdict } from '../ihttp-router';
import { parseRoutes, type ParsedRoutes } from '../ihttp-routes';
import { instanceLimits, STANDARD_IHTTP_LIMITS, type P2pCaps } from '../limits';

const APP: string = 'net.avarok.compute-pool';
const peer = (via: Caller['via']): Caller => ({ username: 'bob', cid: 12n, app_id: APP, install_id: 'i-2', via });
const toBob: Address = { user: { app_id: APP, username: 'bob' } };
const f = (stream: bigint, kind: IhttpFrame['kind']): IhttpFrame => ({ v: 1, stream, kind });
const head = (stream: bigint): IhttpFrame => f(stream, { RequestHead: { method: 'GET', path: '/job', query: '', headers: [], body_len: null, app_id: APP, scope_key: 'ws' } });
const responseHead = (stream: bigint, bodyLen: bigint | null): IhttpFrame => f(stream, { ResponseHead: { status: 200, headers: [], body_len: bodyLen } });
const body = (stream: bigint, n: number): IhttpFrame => f(stream, { Body: { bytes: new Uint8Array(n) } });

/** The manifest's `limits.p2p`, through instanceLimits as the zone gives it. */
function caps(max_fanout_concurrency: number, max_response_bytes: number): P2pCaps | null {
  return instanceLimits({ p2p: { max_fanout_concurrency, max_fanout_bytes: 1 << 20, max_fanout_ms: 20_000, max_response_bytes } }).p2p;
}

function router(p2p: P2pCaps | null): IhttpRouter {
  const r: IhttpRouter = new IhttpRouter(APP, STANDARD_IHTTP_LIMITS, p2p);
  const parsed: ParsedRoutes = parseRoutes([{ method: 'GET', path: '/job' }], 64, 2048);
  if (!parsed.ok) throw new Error(parsed.reason);
  r.setRoutes(parsed.routes, { relay: true, p2p: true });
  return r;
}

const refusal = (v: Verdict): unknown => (v.ok ? null : v.refused);
const kinds = (actions: readonly RouterAction[]): string[] => actions.map((a: RouterAction) => {
  const k: IhttpFrame['kind'] = a.frame.kind;
  return `${a.kind}:${typeof k === 'string' ? k : Object.keys(k)[0]}`;
});

/** Serves one request on `via` and answers it with `sizes` body chunks: what the last chunk was told. */
function serve(p2p: P2pCaps | null, via: Caller['via'], sizes: readonly number[]): unknown {
  const r: IhttpRouter = router(p2p);
  r.inbound(peer(via), head(1n), 0);
  r.respond(peer(via), responseHead(1n, null), 0);
  return sizes.map((n: number) => refusal(r.respond(peer(via), body(1n, n), 0))).at(-1);
}

describe('a served response is held to max_response_bytes on P2P', () => {
  it('exactly the cap passes, one byte more is a Limit; the relay is not held to it', () => {
    const p2p: P2pCaps | null = caps(8, 8);
    expect(serve(p2p, 'p2p', [5, 3])).toBeNull();
    expect(serve(p2p, 'p2p', [5, 4])).toEqual({ limit: 'response_body' });
    expect(serve(p2p, 'relay', [5, 4])).toBeNull();
    expect(serve(null, 'p2p', [5, 4])).toBeNull();
  });

  it('a head declaring more than the cap is a Limit, and the caller is told', () => {
    const r: IhttpRouter = router(caps(8, 8));
    r.inbound(peer('p2p'), head(1n), 0);
    const v: Verdict = r.respond(peer('p2p'), responseHead(1n, 9n), 0);
    expect([refusal(v), kinds(v.actions)]).toEqual([{ limit: 'response_body' }, ['reply:Cancel', 'deliver:Cancel']]);
  });
});

describe('a call answered over P2P is held to max_response_bytes', () => {
  it('one byte past the cap ends the call; exactly the cap is delivered', () => {
    const answered = (sizes: readonly number[]): string[] => {
      const r: IhttpRouter = router(caps(8, 8));
      r.call(toBob, head(1n), 'p2p', 0);
      r.inbound(peer('p2p'), responseHead(1n, null), 0);
      return sizes.flatMap((n: number) => kinds(r.inbound(peer('p2p'), body(1n, n), 0))).slice(-2);
    };
    expect(answered([5, 3])).toEqual(['deliver:Body', 'deliver:Body']);
    expect(answered([5, 4])).toEqual(['reply:Cancel', 'deliver:Cancel']);
  });
});

describe('calls that may go P2P are held to max_fanout_concurrency', () => {
  const open = (r: IhttpRouter, n: number, transport: Transport): Verdict[] =>
    Array.from({ length: n }, (_x: unknown, i: number) => r.call(toBob, head(BigInt(i + 1)), transport, 0));

  it('at a fan-out of 8 the 9th live call is refused', () => {
    const r: IhttpRouter = router(caps(8, 65_536));
    const out: Verdict[] = open(r, 9, 'p2p');
    expect(out.slice(0, 8).every((v: Verdict) => v.ok)).toBe(true);
    expect(refusal(out[8])).toEqual({ limit: 'calls' });
  });

  it('at a fan-out of 3 the 4th is refused, whether named P2P or preferring it; relay calls are not counted', () => {
    const r: IhttpRouter = router(caps(3, 65_536));
    expect(open(r, 3, 'prefer_p2p_then_relay').every((v: Verdict) => v.ok)).toBe(true);
    expect(refusal(r.call(toBob, head(4n), 'p2p', 0))).toEqual({ limit: 'calls' });
    expect(r.call(toBob, head(5n), 'relay', 0).ok).toBe(true);
    expect(router(null).call(toBob, head(1n), 'p2p', 0).ok).toBe(true);
  });

  it('a call that ends frees its place', () => {
    const r: IhttpRouter = router(caps(1, 65_536));
    r.call(toBob, head(1n), 'p2p', 0);
    r.call(toBob, f(1n, { Cancel: { reason: 'caller' } }), 'p2p', 0);
    expect(r.call(toBob, head(2n), 'p2p', 0).ok).toBe(true);
  });
});
