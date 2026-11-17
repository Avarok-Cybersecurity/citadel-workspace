/**
 * The dispatcher's guards over fake ports, in the reference host's order. Each refusal has its
 * control: the same call passing once the guard's condition is not met.
 */
import { describe, expect, it } from 'vitest';
import type { Caller } from '../../sdk/generated/Caller';
import type { DrawCommand } from '../../sdk/generated/DrawCommand';
import type { HostFetch } from '../../sdk/generated/HostFetch';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import { decodeCbor, encodeCbor, type Decoded } from '../cbor';
import type { Capability } from '../capabilities';
import { Dispatcher, type DispatchOutcome } from '../dispatch';
import { IhttpRouter } from '../ihttp-router';
import { directInvoker } from '../invoker';
import { STANDARD_HOST_POLICY, type HostPolicy } from '../limits';
import type { HostPorts, PortAnswer, PortReply } from '../ports';
import { fakeHostNet, fakeIhttp, fakeLog, fakeNodes, fakeStorage, fakeUi, ManualClock, type Recorder } from './fakes';

interface Rig {
  readonly d: Dispatcher;
  readonly rec: Recorder;
  readonly clock: ManualClock;
}

const PAGE: string = 'https://work.avarok.net/workspace';

function rig(granted: readonly Capability[], ports: (rec: Recorder) => HostPorts, policy: Partial<HostPolicy> = {}): Rig {
  const rec: Recorder = { calls: [] };
  const clock: ManualClock = new ManualClock();
  const p: HostPolicy = { ...STANDARD_HOST_POLICY, ...policy };
  const d: Dispatcher = new Dispatcher({
    granted: new Set<Capability>(['canvas', 'ui', 'events', 'navigate', 'log', ...granted]),
    policy: p, clock, invoker: directInvoker(ports(rec)), router: new IhttpRouter('com.acme.app', p.ihttp, null), pageUrl: PAGE, routerActions: (): void => {}, topics: null,
  });
  return { d, rec, clock };
}

const req = (value: unknown): Uint8Array => encodeCbor(value);

export async function answer(outcome: DispatchOutcome): Promise<unknown> {
  const bytes: Uint8Array = 'now' in outcome ? outcome.now : await outcome.later;
  const decoded: Decoded = decodeCbor(bytes);
  if (!decoded.ok) throw new Error('reply is not CBOR');
  return decoded.value;
}

const all = (rec: Recorder): HostPorts => ({ nodes: fakeNodes(rec), storage: fakeStorage(rec), ui: fakeUi(rec), log: fakeLog(rec), hostNet: fakeHostNet(rec) });
const log = (message: string): Uint8Array => req({ level: 'info', message });
const fetchReq: HostFetch = { request: { method: 'GET', url: 'https://api.acme.com/', headers: [], body: new Uint8Array() } };

describe('capabilities', () => {
  it('an op whose capability is not granted is ungranted, inside an open group (control: the granted op)', async () => {
    const { d, rec } = rig(['nodes.read'], all);
    expect(await answer(d.call('nodes', 4, req({ parent_id: 'n1', name: 'x' })))).toEqual({ refused: 'ungranted' });
    expect(rec.calls).toEqual([]);
    expect(await answer(d.call('nodes', 1, req({ node_id: 'n1' })))).toMatchObject({ ok: { node_id: 'n1', name: 'Board' } });
    expect(rec.calls.map((c) => c.method)).toEqual(['NodeGet']);
  });

  it('storage is gated per backend, KV_BACKEND_CAPABILITY, node backend included', async () => {
    const node: Uint8Array = req({ backend: { node: { node_id: 'n1' } }, key: 'k' });
    const user: Rig = rig(['storage.user'], all);
    expect(await answer(user.d.call('storage', 1, req({ backend: 'scope', key: 'k' })))).toEqual({ refused: 'ungranted' });
    expect(await answer(user.d.call('storage', 1, node))).toEqual({ refused: 'ungranted' });
    expect(await answer(user.d.call('storage', 1, req({ key: 'k' })))).toEqual({ refused: { policy: 'bad_arguments' } });
    expect(await answer(user.d.call('storage', 1, req({ backend: 'node', key: 'k' })))).toEqual({ refused: { policy: 'bad_arguments' } });
    expect(await answer(user.d.call('storage', 1, req({ backend: 'user', key: 'k' })))).toEqual({ ok: { value: null } });
    const byNode: Rig = rig(['storage.node'], all);
    expect(await answer(byNode.d.call('storage', 1, node))).toEqual({ ok: { value: null } });
    expect(await answer(byNode.d.call('storage', 1, req({ backend: 'user', key: 'k' })))).toEqual({ refused: 'ungranted' });
    expect([user.rec.calls.length, byNode.rec.calls.length]).toEqual([1, 1]);
  });

  it('a port that is not injected answers unavailable (control: injected answers)', async () => {
    expect(await answer(rig(['nodes.read'], () => ({})).d.call('nodes', 1, req({ node_id: 'n1' })))).toEqual({ refused: { unavailable: 'nodes' } });
    expect(await answer(rig(['nodes.read'], all).d.call('nodes', 1, req({ node_id: 'n1' })))).toMatchObject({ ok: {} });
  });

  it('the streaming net ops reach the host-net port under net.host (control: ungranted without it)', async () => {
    expect(await answer(rig([], all).d.call('net', 3, req(fetchReq)))).toEqual({ refused: 'ungranted' });
    const { d, rec } = rig(['net.host'], all);
    expect(await answer(d.call('net', 3, req(fetchReq)))).toEqual({ ok: { stream: 7, status: 200, headers: [] } });
    expect(await answer(d.call('net', 4, req({ stream: 7, max: 1024 })))).toMatchObject({ ok: { end: true } });
    expect(await answer(d.call('net', 5, req({ stream: 7 })))).toEqual({ ok: null });
    expect(rec.calls.map((c) => c.method)).toEqual(['HostFetchOpen', 'NetStreamRead', 'NetStreamClose']);
  });
});

describe('rate limits', () => {
  it('the 201st host call within a second is refused; the 200th and a call a second later pass', async () => {
    const { d, clock } = rig([], all);
    for (let i: number = 0; i < 200; i++) expect(await answer(d.call('log', 1, log(`${i}`)))).toEqual({ ok: null });
    expect(await answer(d.call('log', 1, log('over')))).toEqual({ refused: { limit: 'host_calls' } });
    clock.advance(1000);
    expect(await answer(d.call('log', 1, log('later')))).toEqual({ ok: null });
  });

  it('the 21st server call within a second is refused while host-only calls still pass', async () => {
    const { d } = rig(['nodes.read'], all);
    for (let i: number = 0; i < 20; i++) expect(await answer(d.call('nodes', 1, req({ node_id: 'n1' })))).toMatchObject({ ok: {} });
    expect(await answer(d.call('nodes', 1, req({ node_id: 'n1' })))).toEqual({ refused: { limit: 'server_calls' } });
    expect(await answer(d.call('ui', 4, req({ text: 'hi' })))).toEqual({ ok: null });
  });

  it('storage.local does not spend the server bucket', async () => {
    const { d } = rig(['storage.local'], all);
    for (let i: number = 0; i < 25; i++) expect(await answer(d.call('storage', 1, req({ backend: 'local', key: 'k' })))).toEqual({ ok: { value: null } });
  });
});

describe('size caps and malformed requests', () => {
  it('requests over the cap, logs over the log cap, and replies over the reply cap are refused', async () => {
    const big: HostPorts = { ui: { ...fakeUi({ calls: [] }), ShowToast: (): PortAnswer<null> => ({ ok: 'x'.repeat(200) as unknown as null }) } };
    const { d } = rig([], () => big, { maxRequestBytes: 64, maxLogBytes: 16, maxReplyBytes: 100 });
    expect(await answer(d.call('ui', 1, new Uint8Array(65)))).toEqual({ refused: { limit: 'request_bytes' } });
    expect(await answer(d.call('log', 1, log('x'.repeat(20))))).toEqual({ refused: { limit: 'log_bytes' } });
    expect(await answer(d.call('ui', 4, req({ text: '' })))).toEqual({ refused: { limit: 'reply_bytes' } });
  });

  it('bytes that are not CBOR, a CBOR non-map, an off-shape argument and an unknown op are refused', async () => {
    const { d } = rig([], all);
    expect(await answer(d.call('ui', 4, Uint8Array.of(0xff, 0x00)))).toEqual({ refused: { policy: 'bad_arguments' } });
    expect(await answer(d.call('ui', 4, req([1, 2])))).toEqual({ refused: { policy: 'bad_arguments' } });
    expect(await answer(d.call('ui', 4, req({ text: 7 })))).toEqual({ refused: { policy: 'bad_arguments' } });
    expect(await answer(d.call('ui', 99, req({})))).toEqual({ refused: { policy: 'unknown_op' } });
    expect(await answer(d.call('ui', 4, req({ text: 'ok', extra: 1 })))).toEqual({ ok: null });
  });

  it('a draw batch with any off-shape command is bad_arguments before the canvas sees it', async () => {
    const drawn: unknown[] = [];
    const canvas: HostPorts = { canvas: { CanvasMeasure: () => ({ ok: { width: 1, height: 1, dpr: 1 } }), MeasureText: () => ({ ok: { width: 0 } }), CanvasDraw: (a) => { drawn.push(a); return { ok: null }; } } };
    const { d } = rig([], () => canvas);
    const clear: DrawCommand = { clear: { color: 0 } };
    for (const bad of [{ fill_rect: { x: 1, y: 2, w: 3, color: 0 } }, { fill_rect: { x: 1, y: 2, w: 3, h: 4, color: 'red; background: url(x)' } }, { draw_image: { url: 'https://evil.example/x.png' } }, 'clear']) {
      expect(await answer(d.call('canvas', 2, req({ commands: [clear, bad] })))).toEqual({ refused: { policy: 'bad_arguments' } });
    }
    expect(drawn).toEqual([]);
    expect(await answer(d.call('canvas', 2, req({ commands: [clear] })))).toEqual({ ok: null });
  });
});

describe('ports that misbehave never reach the guest as exceptions', () => {
  const ui = (toast: () => unknown): HostPorts => ({ ui: { ...fakeUi({ calls: [] }), ShowToast: toast as () => PortReply<null> } });
  const toast: Uint8Array = req({ text: 'hi' });

  it('a port that throws, rejects or answers garbage is refused', async () => {
    expect(await answer(rig([], () => ui(() => { throw new Error('boom'); })).d.call('ui', 4, toast))).toEqual({ refused: { unavailable: 'port_failed' } });
    expect(await answer(rig([], () => ui(() => Promise.reject(new Error('no')))).d.call('ui', 4, toast))).toEqual({ refused: { unavailable: 'port_failed' } });
    expect(await answer(rig([], () => ui(() => ({ hello: 1 }))).d.call('ui', 4, toast))).toEqual({ refused: { unavailable: 'port_answer' } });
  });

  it('a port that never answers times out on its own clock; network calls have a longer one', async () => {
    const never = (): Promise<never> => new Promise<never>(() => {});
    const r: Rig = rig(['nodes.read', 'net.host'], (rec) => ({ nodes: { ...fakeNodes(rec), NodeGet: never }, hostNet: { ...fakeHostNet(rec), HostFetch: never } }));
    const nodes: DispatchOutcome = r.d.call('nodes', 1, req({ node_id: 'n1' }));
    const net: DispatchOutcome = r.d.call('net', 1, req(fetchReq));
    let netDone: boolean = false;
    if ('later' in net) void net.later.then(() => { netDone = true; });
    r.clock.advance(STANDARD_HOST_POLICY.portTimeoutMs);
    expect(await answer(nodes)).toEqual({ refused: { limit: 'timeout' } });
    await Promise.resolve();
    expect(netDone).toBe(false);
    r.clock.advance(STANDARD_HOST_POLICY.hostNetTimeoutMs);
    expect(await answer(net)).toEqual({ refused: { limit: 'timeout' } });
  });
});

describe('navigate: internal links only', () => {
  it('opens a same-origin link as a router path and refuses everything else', async () => {
    const opened: string[] = [];
    const nav = (): HostPorts => ({ navigate: { currentUrl: () => PAGE, open: (to: string): PortAnswer<null> => { opened.push(to); return { ok: null }; } } });
    const { d } = rig([], nav);
    expect(await answer(d.call('navigate', 1, req({ href: '/workspace?nodeId=7' })))).toEqual({ ok: null });
    expect(await answer(d.call('navigate', 1, req({ href: 'https://work.avarok.net/workspace?nodeId=8' })))).toEqual({ ok: null });
    for (const href of ['https://evil.example/', 'javascript:alert(1)', 'mailto:a@b.c', 'data:text/html,x']) {
      expect(await answer(d.call('navigate', 1, req({ href })))).toEqual({ refused: { policy: 'not_an_internal_link' } });
    }
    expect(opened).toEqual(['/workspace?nodeId=7', '/workspace?nodeId=8']);
  });
});

describe('ihttp gate', () => {
  const peer: Caller = { username: 'bob', cid: 5n, app_id: 'com.acme.app', install_id: 'i', via: 'p2p' };

  it('serve refuses a malformed route table; respond and consumed refuse a stream nobody opened', async () => {
    const { d } = rig(['ihttp.serve'], (rec) => ({ ihttp: fakeIhttp(rec) }));
    expect(await answer(d.call('ihttp', 1, req({ routes: [{ method: 'GET', path: 'nope' }], on: { relay: true, p2p: false } })))).toEqual({ refused: { policy: 'bad_routes' } });
    expect(await answer(d.call('ihttp', 1, req({ routes: [{ method: 'GET', path: '/cards/:id' }], on: { relay: true, p2p: false } })))).toEqual({ ok: null });
    const frame: IhttpFrame = { v: 1, stream: 1n, kind: { ResponseHead: { status: 200, headers: [], body_len: null } } };
    expect(await answer(d.call('ihttp', 2, req({ peer, frame })))).toEqual({ refused: { policy: 'unknown_stream' } });
    expect(await answer(d.call('ihttp', 4, req({ peer, stream: 1n })))).toEqual({ refused: { policy: 'unknown_stream' } });
    expect(await answer(d.call('ihttp', 3, req({ to: { user: { app_id: 'com.acme.app', username: 'bob' } }, frame, transport: 'relay' })))).toEqual({ refused: 'ungranted' });
  });

  it('an advertisement asking for a plane not held reaches the port with the held one, and answers ungranted (control: asking only for it)', async () => {
    const { d, rec } = rig(['ihttp.serve'], (r) => ({ ihttp: fakeIhttp(r) }));
    const routes: unknown[] = [{ method: 'GET', path: '/a' }];
    expect(await answer(d.call('ihttp', 1, req({ routes, on: { relay: true, p2p: true } })))).toEqual({ refused: 'ungranted' });
    expect(await answer(d.call('ihttp', 1, req({ routes, on: { relay: true, p2p: false } })))).toEqual({ ok: null });
    expect(rec.calls.map((c) => c.args)).toEqual([{ routes, on: { relay: true, p2p: false } }, { routes, on: { relay: true, p2p: false } }]);
  });

  it('IhttpConsumed is admitted by either ihttp capability and by nothing else', async () => {
    const consumed: Uint8Array = req({ peer, stream: 1n });
    for (const cap of ['ihttp.serve', 'ihttp.call'] as const) {
      expect(await answer(rig([cap], (rec) => ({ ihttp: fakeIhttp(rec) })).d.call('ihttp', 4, consumed))).toEqual({ refused: { policy: 'unknown_stream' } });
    }
    expect(await answer(rig(['nodes.read'], (rec) => ({ ihttp: fakeIhttp(rec) })).d.call('ihttp', 4, consumed))).toEqual({ refused: 'ungranted' });
  });
});
