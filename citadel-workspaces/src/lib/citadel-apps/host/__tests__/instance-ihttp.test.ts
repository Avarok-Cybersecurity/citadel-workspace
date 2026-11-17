/**
 * Internal HTTP through a whole instance: the guest advertises a route in app_init, inbound frames
 * arrive from the IhttpPort, the worker's router admits the advertised route to the guest (which
 * answers it with IhttpRespond) and answers an unadvertised one with Cancel through
 * IhttpPort.respond; and closing the instance cancels the stream it was serving as `closed`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { encodeCbor } from '../cbor';
import type { Capability } from '../capabilities';
import type { Caller } from '../../sdk/generated/Caller';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import { inspectArtifact, type LoadVerdict } from '../inspect';
import { launchAppInstance, type AppInstance, type Launch } from '../instance';
import { InstanceSlots } from '../instance-slots';
import { STANDARD_HOST_POLICY } from '../limits';
import type { HostPorts, IhttpPort, InboundIhttpFrame } from '../ports';
import { appModule, callGroup, FIXTURE_CLOSE_GRACE_MS, fixtureContext, type AppModuleOptions } from './app-fixtures';
import { fakeIhttp, type Recorder } from './fakes';
import { inProcess, realClock, until, type InProcess } from './in-process';
import { op } from './wasm-builder';

const APP: string = 'com.acme.board';
const ROUTES_AT: number = 256;
const RESPOND_AT: number = 1024;
const routes: Uint8Array = encodeCbor({ routes: [{ method: 'GET', path: '/cards/:id' }], on: { relay: true, p2p: false } });
const peer: Caller = { username: 'bob', cid: 42n, app_id: APP, install_id: 'i-bob', via: 'relay' };
const ok: IhttpFrame = { v: 1, stream: 2n, kind: { ResponseHead: { status: 200, headers: [], body_len: 0n } } };
const respond: Uint8Array = encodeCbor({ peer, frame: ok });

/** init: IhttpServe(routes). event: anything longer than 60 bytes (a request) is answered with `ok`. */
function server(answers: boolean = true): Uint8Array {
  const base: AppModuleOptions = { groups: ['ihttp'] };
  const init: number[] = [...callGroup(base, 'ihttp', 1, ROUTES_AT, routes.byteLength), ...op.i32(0)];
  const event: number[] = answers ? [...op.localGet(1), ...op.i32(60), 0x4b, 0x04, 0x40, ...callGroup(base, 'ihttp', 2, RESPOND_AT, respond.byteLength), 0x0b] : [];
  return appModule({ ...base, init, event, data: [{ offset: ROUTES_AT, bytes: routes }, { offset: RESPOND_AT, bytes: respond }] });
}

const request = (stream: bigint, path: string): IhttpFrame => ({
  v: 1, stream, kind: { RequestHead: { method: 'GET', path, query: '', headers: [], body_len: 0n, app_id: APP, scope_key: 'ws' } },
});

let rig: InProcess | null = null;
afterEach(() => rig?.close());

interface Serving { readonly i: AppInstance; readonly rec: Recorder; readonly responded: [Caller, IhttpFrame][]; readonly inbound: (f: InboundIhttpFrame) => void }

async function serving(module: Uint8Array): Promise<Serving> {
  const rec: Recorder = { calls: [] };
  const responded: [Caller, IhttpFrame][] = [];
  let inbound: (f: InboundIhttpFrame) => void = () => {};
  const ihttp: IhttpPort = fakeIhttp(rec, responded);
  const ports: HostPorts = { ihttp: { ...ihttp, onFrame: (listener: (f: InboundIhttpFrame) => void) => { inbound = listener; return () => {}; } } };
  const granted: ReadonlySet<Capability> = new Set<Capability>(['ihttp.serve']);
  const verdict: LoadVerdict = await inspectArtifact(module, granted, 16);
  if (!verdict.ok) throw new Error(verdict.reasons.join(', '));
  rig = inProcess();
  const launched: Launch = launchAppInstance({
    appId: APP, module: verdict.module, granted, memory: { initialPages: 1, maxPages: 16 }, context: fixtureContext([...granted], FIXTURE_CLOSE_GRACE_MS), closeGraceMs: FIXTURE_CLOSE_GRACE_MS, pageUrl: 'https://work.avarok.net/',
    policy: STANDARD_HOST_POLICY, limits: { topics: null, p2p: null }, ports, clock: realClock, slots: new InstanceSlots(8), spawn: rig.spawn,
  });
  if (!launched.ok) throw new Error('no slot');
  const i: AppInstance = launched.instance;
  await until(() => i.state === 'running' && rec.calls.length === 1, 2000);
  expect(rec.calls[0]).toEqual({ method: 'IhttpServe', args: { routes: [{ method: 'GET', path: '/cards/:id' }], on: { relay: true, p2p: false } } });
  return { i, rec, responded, inbound: (f: InboundIhttpFrame): void => inbound(f) };
}

describe('ihttp through an instance', () => {
  it('an unadvertised route is cancelled back to the caller; the advertised one reaches the guest', async () => {
    const { responded, inbound }: Serving = await serving(server());

    inbound({ from: peer, frame: request(1n, '/admin') });
    await until(() => responded.length === 1, 2000);
    expect(responded[0][1].kind).toEqual({ Cancel: { reason: 'unrouted' } });

    inbound({ from: peer, frame: request(2n, '/cards/7') });
    await until(() => responded.length === 2, 2000);
    expect(responded[1]).toEqual([peer, ok]);
  });

  it('closing the instance cancels the stream it serves, as closed', async () => {
    const { i, responded, inbound }: Serving = await serving(server(false));
    inbound({ from: peer, frame: request(3n, '/cards/7') });
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(responded).toEqual([]);
    expect((await i.close('unmount')).ending).toBe('settled');
    expect(responded).toEqual([[peer, { v: 1, stream: 3n, kind: { Cancel: { reason: 'closed' } } }]]);
  });
});
