/**
 * PreferP2pThenRelay (owner decision OD10): a stream picks its plane at its RequestHead, falls
 * back to the relay only when P2P refused before any frame reached the peer and only when the
 * relay is held, and never switches after. The two planes are recording fakes of IhttpPort, the
 * router's only I/O; the router under test is the production one.
 */
import { describe, expect, it } from 'vitest';
import type { Capability } from '../../host/capabilities';
import type { IhttpPort, InboundIhttpFrame, PortAnswer } from '../../host/ports';
import type { Address } from '../../sdk/generated/Address';
import type { Caller } from '../../sdk/generated/Caller';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import type { Transport } from '../../sdk/generated/Transport';
import { transportRouter } from '../ihttp-transport-router';

const APP: string = 'net.avarok.compute-pool';
const to: Address = { user: { app_id: APP, username: 'bob' } };
/** The SDK writes no scope for a member's address (citadel-app-sdk ihttp/client.rs `target`); the host names it. */
const head = (stream: bigint): IhttpFrame => ({ v: 1, stream, kind: { RequestHead: { method: 'POST', path: '/job/primes', query: '', headers: [], body_len: 0n, app_id: APP, scope_key: '' } } });
const SCOPE: string = 'workspace';
const end = (stream: bigint): IhttpFrame => ({ v: 1, stream, kind: 'End' });
const body = (stream: bigint): IhttpFrame => ({ v: 1, stream, kind: { Body: { bytes: new Uint8Array([1]) } } });

interface Plane {
  port: IhttpPort; sent: bigint[]; heads: IhttpFrame[]; answer: PortAnswer<null>; inbound: (i: InboundIhttpFrame) => void;
  /** Set: the next head is answered only when it resolves, as a port that awaits the kernel or the agent does. */
  gate: Promise<void> | null;
}

function plane(): Plane {
  const p: Plane = { sent: [], heads: [], answer: { ok: null }, inbound: () => undefined, gate: null, port: undefined as unknown as IhttpPort };
  p.port = {
    IhttpServe: async (): Promise<PortAnswer<null>> => ({ ok: null }),
    IhttpCall: async ({ frame }): Promise<PortAnswer<null>> => {
      const isHead: boolean = typeof frame.kind === 'object' && 'RequestHead' in frame.kind;
      if (isHead && p.gate !== null) await p.gate;
      p.sent.push(frame.stream);
      if (isHead) p.heads.push(frame);
      return p.answer;
    },
    respond: async (_peer: Caller, f: IhttpFrame): Promise<PortAnswer<null>> => { p.sent.push(f.stream); return { ok: null }; },
    onFrame: (l): (() => void) => { p.inbound = l; return (): void => undefined; },
  };
  return p;
}

interface Rig { relay: Plane; p2p: Plane; call: (t: Transport, f: IhttpFrame) => Promise<PortAnswer<null>>; router: IhttpPort }

const rig = (held: Capability[]): Rig => {
  const relay: Plane = plane();
  const p2p: Plane = plane();
  const router: IhttpPort = transportRouter({ relay: relay.port, p2p: p2p.port, held: new Set<Capability>(held), scopeKey: SCOPE });
  return { relay, p2p, router, call: async (transport: Transport, frame: IhttpFrame) => router.IhttpCall({ to, frame, transport }) };
};

describe('a stream keeps the plane it opened on', () => {
  it('prefer opens on P2P and every later frame follows it', async () => {
    const r: Rig = rig(['ihttp.p2p.call', 'ihttp.call']);
    expect(await r.call('prefer_p2p_then_relay', head(1n))).toEqual({ ok: null });
    expect(await r.call('prefer_p2p_then_relay', end(1n))).toEqual({ ok: null });
    expect([r.p2p.sent, r.relay.sent]).toEqual([[1n, 1n], []]);
  });

  it('falls back to the relay when P2P refused before opening, and stays there', async () => {
    const r: Rig = rig(['ihttp.p2p.call', 'ihttp.call']);
    r.p2p.answer = { refused: { unavailable: 'p2p_not_advertised' } };
    expect(await r.call('prefer_p2p_then_relay', head(1n))).toEqual({ ok: null });
    r.p2p.answer = { ok: null };
    expect(await r.call('prefer_p2p_then_relay', end(1n))).toEqual({ ok: null });
    expect([r.p2p.sent, r.relay.sent]).toEqual([[1n], [1n, 1n]]);
  });

  it('without the relay capability it answers unavailable:p2p and sends nothing on the relay', async () => {
    const r: Rig = rig(['ihttp.p2p.call']);
    r.p2p.answer = { refused: { unavailable: 'refused' } };
    expect(await r.call('prefer_p2p_then_relay', head(1n))).toEqual({ refused: { unavailable: 'p2p' } });
    expect(r.relay.sent).toEqual([]);
  });

  it('a refusal after the frame reached the peer is not a reason to fall back', async () => {
    const r: Rig = rig(['ihttp.p2p.call', 'ihttp.call']);
    r.p2p.answer = { refused: { unavailable: 'p2p_queue' } };
    expect(await r.call('prefer_p2p_then_relay', head(1n))).toEqual({ refused: { unavailable: 'p2p_queue' } });
    expect(r.relay.sent).toEqual([]);
  });

  it('an explicit p2p call never falls back, and an explicit relay call never touches P2P', async () => {
    const r: Rig = rig(['ihttp.p2p.call', 'ihttp.call']);
    r.p2p.answer = { refused: { unavailable: 'refused' } };
    expect(await r.call('p2p', head(1n))).toEqual({ refused: { unavailable: 'refused' } });
    expect(await r.call('relay', head(2n))).toEqual({ ok: null });
    expect([r.p2p.sent, r.relay.sent]).toEqual([[1n], [2n]]);
  });

  it('prefer with only the relay held goes straight to the relay; neither held is ungranted', async () => {
    const r: Rig = rig(['ihttp.call']);
    expect(await r.call('prefer_p2p_then_relay', head(1n))).toEqual({ ok: null });
    expect([r.p2p.sent, r.relay.sent]).toEqual([[], [1n]]);
    expect(await rig([]).call('prefer_p2p_then_relay', head(1n))).toEqual({ refused: 'ungranted' });
  });

  it('a frame on a stream no head opened is refused, and a response goes back the way it came', async () => {
    const r: Rig = rig(['ihttp.p2p.call', 'ihttp.call']);
    expect(await r.call('p2p', end(9n))).toEqual({ refused: { policy: 'unknown_stream' } });
    const caller: Caller = { username: 'carol', cid: 3n, app_id: APP, install_id: 'i', via: 'p2p' };
    await r.router.respond(caller, end(4n));
    await r.router.respond({ ...caller, via: 'relay' }, end(5n));
    expect([r.p2p.sent, r.relay.sent]).toEqual([[4n], [5n]]);
  });

  it('frames sent before the head is answered wait for it, then follow it on its plane, in order', async () => {
    const r: Rig = rig(['ihttp.p2p.call', 'ihttp.call']);
    let open: () => void = (): void => undefined;
    r.p2p.gate = new Promise<void>((resolve: () => void): void => { open = resolve; });
    // As the host dispatches an app's call: the SDK sends head, body and End without waiting for any answer.
    const answers: Promise<PortAnswer<null>>[] = [r.call('p2p', head(1n)), r.call('p2p', body(1n)), r.call('p2p', end(1n))];
    open();
    expect(await Promise.all(answers)).toEqual([{ ok: null }, { ok: null }, { ok: null }]);
    expect(r.p2p.sent).toEqual([1n, 1n, 1n]);
  });

  it('frames behind a head that fell back go to the relay, and behind a refused head are refused', async () => {
    const r: Rig = rig(['ihttp.p2p.call', 'ihttp.call']);
    r.p2p.answer = { refused: { unavailable: 'refused' } };
    const fell: Promise<PortAnswer<null>>[] = [r.call('prefer_p2p_then_relay', head(1n)), r.call('prefer_p2p_then_relay', end(1n))];
    expect(await Promise.all(fell)).toEqual([{ ok: null }, { ok: null }]);
    const refused: Promise<PortAnswer<null>>[] = [r.call('p2p', head(2n)), r.call('p2p', end(2n))];
    expect(await Promise.all(refused)).toEqual([{ refused: { unavailable: 'refused' } }, { refused: { policy: 'unknown_stream' } }]);
    expect([r.p2p.sent, r.relay.sent]).toEqual([[1n, 2n], [1n, 1n]]);
  });

  it('a head to a member names the scope the install is addressed by; a head to a scope names that scope', async () => {
    const r: Rig = rig(['ihttp.p2p.call', 'ihttp.call']);
    await r.call('p2p', head(1n));
    await r.router.IhttpCall({ to: { scope: { app_id: APP, scope_key: 'node:n1' } }, frame: head(2n), transport: 'relay' });
    const scopes = (p: Plane): string[] => p.heads.map((f: IhttpFrame) => (typeof f.kind === 'object' && 'RequestHead' in f.kind ? f.kind.RequestHead.scope_key : ''));
    expect([scopes(r.p2p), scopes(r.relay)]).toEqual([[SCOPE], ['node:n1']]);
  });
});
