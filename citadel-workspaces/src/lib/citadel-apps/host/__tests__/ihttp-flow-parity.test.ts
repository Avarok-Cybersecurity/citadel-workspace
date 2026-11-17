/**
 * The P2P host holds a stream's flow as the relay does (W3: S7, S8, E2, E8), and names every
 * fault in the wire's closed set: what the peer receives is the wire reason, what the app is
 * handed is that reason's word. Each guard sits beside the control that shows it is the guard.
 */
import { describe, expect, it } from 'vitest';
import type { Address } from '../../sdk/generated/Address';
import type { Caller } from '../../sdk/generated/Caller';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import type { RequestHead } from '../../sdk/generated/RequestHead';
import type { CancelReason } from '../../sdk/wire-generated/CancelReason';
import type { IhttpFrame as WireFrame } from '../../sdk/wire-generated/IhttpFrame';
import type { Verdict } from '../ihttp-common';
import { IhttpRouter, type RouterAction } from '../ihttp-router';
import { parseRoutes, type ParsedRoutes } from '../ihttp-routes';
import { toWireFrame, RELAY_STREAM_BIT } from '../ihttp-wire';
import { STANDARD_IHTTP_LIMITS as L } from '../limits';

const APP: string = 'com.acme.kanban';
const alice: Caller = { username: 'alice', cid: 11n, app_id: APP, install_id: 'i-1', via: 'p2p' };
const toAlice: Address = { user: { app_id: APP, username: 'alice' } };

function router(): IhttpRouter {
  const r: IhttpRouter = new IhttpRouter(APP, L, null);
  const parsed: ParsedRoutes = parseRoutes([{ method: 'POST', path: '/up' }], 64, 2048);
  if (!parsed.ok) throw new Error(parsed.reason);
  r.setRoutes(parsed.routes, { relay: true, p2p: true });
  return r;
}

const f = (stream: bigint, kind: IhttpFrame['kind']): IhttpFrame => ({ v: 1, stream, kind });
const head = (bodyLen: bigint | null): RequestHead => ({ method: 'POST', path: '/up', query: '', headers: [], body_len: bodyLen, app_id: APP, scope_key: 'ws' });
const body = (stream: bigint, n: number): IhttpFrame => f(stream, { Body: { bytes: new Uint8Array(n) } });
const responseHead = (stream: bigint, bodyLen: bigint | null): IhttpFrame => f(stream, { ResponseHead: { status: 200, headers: [], body_len: bodyLen } });

/** What the peer receives for each Cancel the host sent it. */
const toPeer = (actions: readonly RouterAction[]): CancelReason[] => actions.flatMap((a: RouterAction): CancelReason[] => {
  if (a.kind === 'deliver') return [];
  const k: WireFrame['kind'] = toWireFrame(a.frame).kind;
  return typeof k === 'object' && 'Cancel' in k ? [k.Cancel.reason] : [];
});
/** What the app is handed for each Cancel delivered to it. */
const toApp = (actions: readonly RouterAction[]): string[] => actions.flatMap((a: RouterAction): string[] =>
  a.kind === 'deliver' && typeof a.frame.kind === 'object' && 'Cancel' in a.frame.kind ? [a.frame.kind.Cancel.reason] : []);

describe('flow faults are Protocol on the P2P host, as on the relay', () => {
  it('a body after the caller’s End (control: before it, the body is delivered)', () => {
    const r: IhttpRouter = router();
    r.inbound(alice, f(1n, { RequestHead: head(null) }), 0);
    expect(toPeer(r.inbound(alice, body(1n, 3), 0))).toEqual([]);
    r.inbound(alice, f(1n, 'End'), 0);
    const after: RouterAction[] = r.inbound(alice, body(1n, 3), 0);
    expect(toPeer(after)).toEqual(['Protocol']);
    expect(toApp(after)).toEqual(['protocol']);
  });

  it('a request shorter than its declared length at End (control: exactly the length ends cleanly)', () => {
    const r: IhttpRouter = router();
    for (const [id, sent] of [[1n, 3], [2n, 5]] as const) {
      r.inbound(alice, f(id, { RequestHead: head(5n) }), 0);
      r.inbound(alice, body(id, sent), 0);
      expect(toPeer(r.inbound(alice, f(id, 'End'), 0))).toEqual(sent === 5 ? [] : ['Protocol']);
    }
  });

  it('a P2P head naming the relay’s stream bit (control: the relay’s own head with it is served)', () => {
    const r: IhttpRouter = router();
    expect(toPeer(r.inbound(alice, f(RELAY_STREAM_BIT | 1n, { RequestHead: head(0n) }), 0))).toEqual(['Protocol']);
    expect(toPeer(r.inbound({ ...alice, via: 'relay' }, f(RELAY_STREAM_BIT | 1n, { RequestHead: head(0n) }), 0))).toEqual([]);
  });

  it('a stream never switches plane: its id on the other plane is not its stream (control: its own plane is)', () => {
    const r: IhttpRouter = router();
    r.inbound(alice, f(1n, { RequestHead: head(null) }), 0);
    expect(toPeer(r.inbound({ ...alice, via: 'relay' }, body(1n, 3), 0))).toEqual(['Protocol']);
    expect(toPeer(r.inbound(alice, body(1n, 3), 0))).toEqual([]);
  });
});

describe('a repeated head (E8)', () => {
  it('for a stream already open is dropped with no Cancel; a stale id that is not open is Protocol', () => {
    const r: IhttpRouter = router();
    r.inbound(alice, f(5n, { RequestHead: head(0n) }), 0);
    expect(r.inbound(alice, f(5n, { RequestHead: head(0n) }), 0)).toEqual([]);
    expect(toPeer(r.inbound(alice, f(4n, { RequestHead: head(0n) }), 0))).toEqual(['Protocol']);
    expect(r.liveStreams).toBe(1);
  });
});

describe('the response body_len holds in both roles', () => {
  it('serving: the app may send neither more nor less than it declared (control: exactly it ends)', () => {
    const r: IhttpRouter = router();
    for (const id of [1n, 2n, 3n]) {
      r.inbound(alice, f(id, { RequestHead: head(0n) }), 0);
      r.respond(alice, responseHead(id, 2n), 0);
    }
    const over: Verdict = r.respond(alice, body(1n, 3), 0);
    expect(over).toMatchObject({ ok: false, refused: { limit: 'response_body' } });
    expect(toPeer(over.actions)).toEqual(['TooLarge']);
    r.respond(alice, body(2n, 1), 0);
    const short: Verdict = r.respond(alice, f(2n, 'End'), 0);
    expect(short).toMatchObject({ ok: false, refused: { policy: 'protocol' } });
    expect(toPeer(short.actions)).toEqual(['Protocol']);
    r.respond(alice, body(3n, 2), 0);
    expect(r.respond(alice, f(3n, 'End'), 0)).toEqual({ ok: true, actions: [] });
  });

  it('calling: the server may send neither more nor less than it declared (control: exactly it is delivered)', () => {
    const r: IhttpRouter = router();
    for (const id of [1n, 2n, 3n]) {
      r.call(toAlice, f(id, { RequestHead: head(0n) }), 'p2p', 0);
      r.inbound(alice, responseHead(id, 2n), 0);
    }
    expect(toPeer(r.inbound(alice, body(1n, 3), 0))).toEqual(['TooLarge']);
    r.inbound(alice, body(2n, 1), 0);
    const short: RouterAction[] = r.inbound(alice, f(2n, 'End'), 0);
    expect(toPeer(short)).toEqual(['Protocol']);
    expect(toApp(short)).toEqual(['protocol']);
    r.inbound(alice, body(3n, 2), 0);
    expect(r.inbound(alice, f(3n, 'End'), 0)).toEqual([{ kind: 'deliver', peer: alice, frame: f(3n, 'End') }]);
  });
});

describe('deadlines (E2, S7)', () => {
  it('a call no server answered still ends for the app at its deadline, and the server is told', () => {
    const r: IhttpRouter = router();
    r.call(toAlice, f(1n, { RequestHead: head(0n) }), 'p2p', 0);
    expect(r.tick(L.streamTimeoutMs - 1)).toEqual([]);
    const out: RouterAction[] = r.tick(L.streamTimeoutMs);
    expect(toApp(out)).toEqual(['timeout']);
    expect(out.find((a: RouterAction) => a.kind === 'deliver')).toMatchObject({ peer: { app_id: APP }, frame: { stream: 1n } });
    expect(out.find((a: RouterAction) => a.kind === 'call')).toMatchObject({ to: toAlice, transport: 'p2p' });
    expect(toPeer(out)).toEqual(['Timeout']);
    expect(r.liveStreams).toBe(0);
  });

  it('every Body or Credit moves the deadline on, never past 60 s from the open (control: idle, it is 30 s)', () => {
    const r: IhttpRouter = router();
    r.inbound(alice, f(1n, { RequestHead: head(null) }), 0);
    r.inbound(alice, f(2n, { RequestHead: head(null) }), 0);
    r.inbound(alice, body(1n, 1), 20_000);
    r.consumed(alice, 1n, 45_000);
    expect(toApp(r.tick(L.streamTimeoutMs))).toEqual(['timeout']);
    expect(r.tick(L.streamingTimeoutMs - 1)).toEqual([]);
    r.inbound(alice, f(1n, { Credit: { n: 1 } }), L.streamingTimeoutMs - 1);
    expect(toPeer(r.tick(L.streamingTimeoutMs))).toEqual(['Timeout']);
  });
});
