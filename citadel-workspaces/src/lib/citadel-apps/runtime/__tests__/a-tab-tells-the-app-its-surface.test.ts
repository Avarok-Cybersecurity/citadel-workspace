/**
 * An app tab runs through the same steps as a zone, placed differently: the app is told it is a
 * node tab (not a zone) and the size of the panel it fills, and is resized in both dimensions; a
 * zone keeps its author's height. A release whose manifest does not list the surface it is mounted
 * on starts nothing, and zones and tabs share the page's instance cap.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { STANDARD_HOST_POLICY } from '../../host/limits';
import { InstanceSlots } from '../../host/instance-slots';
import { until } from '../../host/__tests__/in-process';
import { appModule } from '../../host/__tests__/app-fixtures';
import { decodeCbor, type Decoded } from '../../host/cbor';
import type { ToWorker } from '../../host/worker-protocol';
import { FakeRuntimeKernel, hostOf, release, rig, slotsOf, tabOf, zoneOf, type Rig } from './runtime-rig';

let rigs: Rig[] = [];
afterEach(() => {
  rigs.forEach((r: Rig) => r.close());
  rigs = [];
  document.body.innerHTML = '';
});
const make = (...args: Parameters<typeof rig>): Rig => {
  const r: Rig = rig(...args);
  rigs.push(r);
  return r;
};
const stateOf = (host: HTMLElement): string | undefined => host.dataset.appState;
const statusOf = (host: HTMLElement): string => host.querySelector('[data-testid="app-zone-status"]')?.textContent ?? '';
const TAB_APP: string[] = ['node_tab'];

function contextOf(r: Rig): Record<string, unknown> {
  const load: ToWorker | undefined = r.sent.find((m: ToWorker): boolean => m.kind === 'load');
  if (load === undefined || load.kind !== 'load') throw new Error('nothing was loaded');
  const decoded: Decoded = decodeCbor(load.context);
  if (!decoded.ok) throw new Error('the context does not decode');
  return decoded.value as Record<string, unknown>;
}
const resizes = (r: Rig): [number, number][] =>
  r.sent.flatMap((m: ToWorker): [number, number][] => (m.kind === 'resize' ? [[m.width, m.height]] : []));

describe('an app mounted as a node tab', () => {
  it('is told it is a node tab, of the panel’s width and height, and resized in both (control: a zone is told its zone)', async () => {
    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(appModule(), [], { surfaces: TAB_APP }));
    const r: Rig = make(kernel);
    const host: HTMLDivElement = hostOf(320, 500);
    r.runtime.mountPane(slotsOf(host), tabOf(kernel.rel));
    await until(() => stateOf(host) === 'running', 4000);
    const context: Record<string, unknown> = contextOf(r);
    expect([context.surface, context.size]).toEqual([{ node_tab: { tab_id: 'calendar' } }, { width: 320, height: 500 }]);
    const canvas: HTMLCanvasElement = host.querySelector('canvas') as HTMLCanvasElement;
    expect([canvas.width, canvas.height, canvas.style.height]).toEqual([640, 1000, '100%']);
    r.watch.resizeTo({ width: 320, height: 640 });
    r.watch.resizeTo({ width: 410.4, height: 640 });
    expect(resizes(r)).toEqual([[320, 640], [410, 640]]);

    const zoned: FakeRuntimeKernel = new FakeRuntimeKernel(release(appModule(), []));
    const z: Rig = make(zoned);
    const zoneHost: HTMLDivElement = hostOf(320);
    z.runtime.mount(slotsOf(zoneHost), zoneOf(zoned.rel));
    await until(() => stateOf(zoneHost) === 'running', 4000);
    expect([contextOf(z).surface, contextOf(z).size]).toEqual([{ md_zone: { zone_id: 'board' } }, { width: 320, height: 240 }]);
  });

  it('a zone keeps its author’s height: a taller host does not resize it, a wider one does', async () => {
    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(appModule(), []));
    const r: Rig = make(kernel);
    const host: HTMLDivElement = hostOf(320);
    r.runtime.mount(slotsOf(host), zoneOf(kernel.rel));
    await until(() => stateOf(host) === 'running', 4000);
    r.watch.resizeTo({ width: 320, height: 900 });
    r.watch.resizeTo({ width: 500, height: 900 });
    expect(resizes(r)).toEqual([[500, 240]]);
  });

  it('a release whose manifest does not list node_tab starts nothing in a tab, and says so (control: as a zone it runs)', async () => {
    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(appModule(), []));
    const r: Rig = make(kernel);
    const host: HTMLDivElement = hostOf(320, 500);
    r.runtime.mountPane(slotsOf(host), tabOf(kernel.rel));
    await until(() => stateOf(host) === 'stopped', 4000);
    expect(statusOf(host)).toBe('Kanban cannot run in a tab, so it was not started.');
    expect(r.spawned()).toBe(0);

    const zoneHost: HTMLDivElement = hostOf(320);
    r.runtime.mount(slotsOf(zoneHost), zoneOf(kernel.rel));
    await until(() => stateOf(zoneHost) === 'running', 4000);
    expect(r.spawned()).toBe(1);
  });

  it('shares the page’s instance cap with its zones', async () => {
    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(appModule(), [], { surfaces: ['md_zone', 'node_tab'] }));
    const r: Rig = make(kernel, { slots: new InstanceSlots(1), policy: STANDARD_HOST_POLICY });
    const zoneHost: HTMLDivElement = hostOf(320);
    const tabHost: HTMLDivElement = hostOf(320, 500);
    r.runtime.mount(slotsOf(zoneHost), zoneOf(kernel.rel));
    await until(() => stateOf(zoneHost) === 'running', 4000);
    r.runtime.mountPane(slotsOf(tabHost), tabOf(kernel.rel));
    await until(() => stateOf(tabHost) === 'stopped', 4000);
    expect(statusOf(tabHost)).toBe('This page is already running as many apps as it can, so Kanban was not started.');
  });
});
