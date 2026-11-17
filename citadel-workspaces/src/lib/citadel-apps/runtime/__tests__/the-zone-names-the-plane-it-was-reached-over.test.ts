/**
 * The zone names the plane its internal HTTP last moved over (E6), so the member sees whether a
 * peer was reached directly or through the server. Each `via` has its own badge text; the badge
 * sits after the app's buttons and shows the bar even with none; and in a mounted zone a frame
 * relayed to the instance moves it. The zone runtime, ports and worker host are the production
 * ones, in process; the server is the rig's fake, its push the one a relayed frame arrives as.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ZoneHost } from '@/components/office/app-zone/app-zone-environment';
import { encodeCbor } from '../../host/cbor';
import { toWireFrame } from '../../host/ihttp-wire';
import type { IhttpPort, InboundIhttpFrame } from '../../host/ports';
import { until } from '../../host/__tests__/in-process';
import type { IhttpFrame } from '../../sdk/generated/IhttpFrame';
import type { Via } from '../../sdk/generated/Via';
import { reportingVia, VIA_BADGE } from '../via-badge';
import { zoneToolbar, type ZoneToolbar } from '../zone-toolbar';
import { APP_ID, FakeRuntimeKernel, hostOf, kvAtInit, release, rig, slotsOf, zoneOf, type Rig } from './runtime-rig';

let rigs: Rig[] = [];
afterEach(() => {
  rigs.forEach((r: Rig) => r.close());
  rigs = [];
  document.body.innerHTML = '';
});

const badge = (bar: HTMLElement): HTMLElement | null => bar.querySelector('[data-testid="app-zone-via"]');

describe('the via badge', () => {
  it('says which plane, for each one', () => {
    const shown: Record<Via, string> = { p2p: 'Peer to peer', relay: 'Through the server', group: 'Over a topic' };
    expect(VIA_BADGE).toEqual(shown);
    for (const via of Object.keys(shown) as Via[]) {
      const t: ZoneToolbar = zoneToolbar(document, 'Pool', () => undefined);
      t.via(via);
      expect([badge(t.element)?.textContent, badge(t.element)?.dataset.via, t.element.style.display]).toEqual([shown[via], via, '']);
    }
  });

  it('is hidden until a frame arrives, sits after the buttons, and survives a toolbar update', () => {
    const t: ZoneToolbar = zoneToolbar(document, 'Pool', () => undefined);
    expect([badge(t.element), t.element.style.display]).toEqual([null, 'none']);
    t.set([{ id: 'run', label: 'Run' }]);
    t.via('p2p');
    t.set([{ id: 'run', label: 'Run' }, { id: 'stop', label: 'Stop' }]);
    expect([...t.element.children].map((c: Element) => c.textContent)).toEqual(['Run', 'Stop', 'Peer to peer']);
    t.set([]);
    t.via('relay');
    expect([[...t.element.children].map((c: Element) => c.textContent), t.element.style.display]).toEqual([['Through the server'], '']);
  });

  it('a reporting port names each frame’s plane before the instance has it', () => {
    let deliver: (i: InboundIhttpFrame) => void = () => undefined;
    const port: IhttpPort = {
      IhttpServe: () => ({ ok: null }), IhttpCall: () => ({ ok: null }), respond: () => ({ ok: null }),
      onFrame: (l: (i: InboundIhttpFrame) => void) => { deliver = l; return (): void => undefined; },
    };
    const order: string[] = [];
    reportingVia(port, (via: Via) => order.push(`heard ${via}`)).onFrame(() => order.push('delivered'));
    deliver({ from: { username: 'bob', cid: 7n, app_id: APP_ID, install_id: 'i', via: 'p2p' }, frame: { v: 1, stream: 1n, kind: 'End' } });
    expect(order).toEqual(['heard p2p', 'delivered']);
  });
});

describe('a mounted zone', () => {
  it('shows the relay once a relayed frame reaches its instance', async () => {
    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(kvAtInit(), ['storage.user']));
    const r: Rig = rig(kernel);
    rigs.push(r);
    const host: HTMLDivElement = hostOf(375);
    const slots: ZoneHost = slotsOf(host);
    r.runtime.mount(slots, zoneOf(kernel.rel));
    await until(() => host.dataset.appState === 'running', 4000);
    expect(badge(slots.toolbar)).toBeNull();
    const head: IhttpFrame = { v: 1, stream: (1n << 63n) | 1n, kind: { RequestHead: { method: 'GET', path: '/a', query: '', headers: [], body_len: 0n, app_id: APP_ID, scope_key: 'ws' } } };
    r.push({ IhttpFrame: { from: { username: 'bob', cid: 7n, app_id: APP_ID, install_id: 'inst-9' }, to_install_id: kernel.rel.install.id, frame: Array.from(encodeCbor(toWireFrame(head))) } });
    await until(() => badge(slots.toolbar) !== null, 4000);
    expect(badge(slots.toolbar)?.textContent).toBe('Through the server');
  });
});
