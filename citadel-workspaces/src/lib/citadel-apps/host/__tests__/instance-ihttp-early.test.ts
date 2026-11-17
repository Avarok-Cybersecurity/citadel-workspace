/**
 * Internal-HTTP frames that reach the handle before it hears app_init returned. The worker posts
 * a call the app makes in init, then `loaded`; the answer can land in between (the SDK fixture
 * ihttp-stream-client lost its whole response that way under load). Played here over a scripted
 * worker, the frame pushed first and `loaded` second, so the interleaving is forced, not hoped for.
 */
import { describe, expect, it } from 'vitest';
import type { Caller } from '../../sdk/generated/Caller';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import type { Capability } from '../capabilities';
import { launchAppInstance, type AppInstance, type Launch } from '../instance';
import { InstanceSlots } from '../instance-slots';
import { STANDARD_HOST_POLICY } from '../limits';
import type { IhttpPort, InboundIhttpFrame } from '../ports';
import type { ToWorker } from '../worker-protocol';
import { FIXTURE_CLOSE_GRACE_MS, fixtureContext } from './app-fixtures';
import { fakeIhttp, ManualClock, type Recorder } from './fakes';
import { scripted, seqOf, type Scripted } from './scripted-channel';

const peer: Caller = { username: 'bob', cid: 2n, app_id: 'com.acme.stream', install_id: 'remote-install', via: 'p2p' };
const head: IhttpFrame = { v: 1, stream: 1n, kind: { ResponseHead: { status: 200, headers: [], body_len: 1n } } };
const body: IhttpFrame = { v: 1, stream: 1n, kind: { Body: { bytes: new Uint8Array([7]) } } };

/** A transport that pushes to whoever is subscribed at that moment, and to no one otherwise. */
interface Transport { readonly port: IhttpPort; readonly push: (f: IhttpFrame) => void; readonly subscribers: () => number }

function transport(): Transport {
  const listeners: Set<(f: InboundIhttpFrame) => void> = new Set<(f: InboundIhttpFrame) => void>();
  const port: IhttpPort = {
    ...fakeIhttp({ calls: [] } as Recorder),
    onFrame: (l: (f: InboundIhttpFrame) => void): (() => void) => {
      listeners.add(l);
      return (): void => { listeners.delete(l); };
    },
  };
  return { port, push: (frame: IhttpFrame): void => [...listeners].forEach((l) => l({ from: peer, frame })), subscribers: () => listeners.size };
}

function launch(s: Scripted, t: Transport): AppInstance {
  const l: Launch = launchAppInstance({
    appId: 'net.avarok.fixture', module: {} as WebAssembly.Module, granted: new Set<Capability>(['ihttp.call']), memory: { initialPages: 1, maxPages: 1 },
    context: fixtureContext(['ihttp.call'], FIXTURE_CLOSE_GRACE_MS), closeGraceMs: FIXTURE_CLOSE_GRACE_MS, pageUrl: 'https://work.avarok.net/',
    policy: STANDARD_HOST_POLICY, limits: { topics: null, p2p: null }, ports: { ihttp: t.port }, clock: new ManualClock(), slots: new InstanceSlots(1), spawn: () => s.channel,
  });
  if (!l.ok) throw new Error('no slot');
  return l.instance;
}

const forwarded = (s: Scripted): IhttpFrame[] =>
  s.sent.flatMap((m: ToWorker): IhttpFrame[] => (m.kind === 'ihttp' ? [m.frame] : []));

describe('ihttp frames that arrive before the handle hears init returned', () => {
  it('reach the worker once init succeeded, in arrival order, after the load', () => {
    const s: Scripted = scripted();
    const t: Transport = transport();
    const i: AppInstance = launch(s, t);
    t.push(head);
    t.push(body);
    expect(forwarded(s)).toEqual([]);

    s.reply({ kind: 'loaded', seq: seqOf(s.sent[0]), status: 0 });

    expect(i.state).toBe('running');
    expect(s.sent[0].kind).toBe('load');
    expect(forwarded(s)).toEqual([head, body]);
    t.push(body);
    expect(forwarded(s)).toEqual([head, body, body]);
  });

  it('are dropped, and the transport left, when init fails', () => {
    const s: Scripted = scripted();
    const t: Transport = transport();
    const i: AppInstance = launch(s, t);
    t.push(head);

    s.reply({ kind: 'loaded', seq: seqOf(s.sent[0]), status: 1 });

    expect(i.state).toBe('init-failed');
    expect(forwarded(s)).toEqual([]);
    expect(t.subscribers()).toBe(0);
  });

  it('are dropped when the instance is terminated before init returns', () => {
    const s: Scripted = scripted();
    const t: Transport = transport();
    const i: AppInstance = launch(s, t);
    t.push(head);

    i.terminate();
    s.reply({ kind: 'loaded', seq: seqOf(s.sent[0]), status: 0 });
    t.push(body);

    expect(forwarded(s)).toEqual([]);
    expect(t.subscribers()).toBe(0);
  });
});
