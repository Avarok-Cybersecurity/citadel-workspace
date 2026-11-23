/**
 * An app mounted as a node's page (node-page-abi.md §3) runs through the same steps as a zone and
 * a tab, placed as a page: it is told `Surface::NodePage` and the size of the pane it fills, and is
 * resized in both dimensions; a release whose manifest does not list `node_page` starts nothing and
 * says it cannot run as a page. The doubles are runtime-rig.ts's (a contract fake of the kernel and
 * the stand-in signature check); the worker host and the instance are the production ones.
 *
 * Negative controls (each applied, seen red, reverted): `surfaceOf` giving a page the tab's surface
 * fails the context; the surface filling its host only for a tab fails the size and resize; the page's
 * refusal phrase changed to the tab's fails the refusal.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { until } from '../../host/__tests__/in-process';
import { appModule } from '../../host/__tests__/app-fixtures';
import { decodeCbor, type Decoded } from '../../host/cbor';
import type { ToWorker } from '../../host/worker-protocol';
import { FakeRuntimeKernel, hostOf, pageOf, release, rig, slotsOf, type Rig } from './runtime-rig';

let rigs: Rig[] = [];
afterEach(() => {
  rigs.forEach((r: Rig) => r.close());
  rigs = [];
  document.body.innerHTML = '';
});
const make = (kernel: FakeRuntimeKernel): Rig => {
  const r: Rig = rig(kernel);
  rigs.push(r);
  return r;
};
const stateOf = (host: HTMLElement): string | undefined => host.dataset.appState;

function contextOf(r: Rig): Record<string, unknown> {
  const load: ToWorker | undefined = r.sent.find((m: ToWorker): boolean => m.kind === 'load');
  if (load === undefined || load.kind !== 'load') throw new Error('nothing was loaded');
  const decoded: Decoded = decodeCbor(load.context);
  if (!decoded.ok) throw new Error('the context does not decode');
  return decoded.value as Record<string, unknown>;
}
const resizes = (r: Rig): [number, number][] =>
  r.sent.flatMap((m: ToWorker): [number, number][] => (m.kind === 'resize' ? [[m.width, m.height]] : []));

describe('an app mounted as a node’s page', () => {
  it('is told it is the node page, of the pane’s width and height, and resized in both', async () => {
    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(appModule(), [], { surfaces: ['node_page'] }));
    const r: Rig = make(kernel);
    const host: HTMLDivElement = hostOf(800, 600);
    r.runtime.mountPage(slotsOf(host), pageOf(kernel.rel));
    await until(() => stateOf(host) === 'running', 4000);
    expect([contextOf(r).surface, contextOf(r).size]).toEqual([{ node_page: {} }, { width: 800, height: 600 }]);
    const canvas: HTMLCanvasElement = host.querySelector('canvas') as HTMLCanvasElement;
    expect([canvas.width, canvas.height, canvas.style.height]).toEqual([1600, 1200, '100%']);
    r.watch.resizeTo({ width: 800, height: 720 });
    r.watch.resizeTo({ width: 390.6, height: 720 });
    expect(resizes(r)).toEqual([[800, 720], [391, 720]]);
  });

  it('a release whose manifest does not list node_page starts nothing, and says it cannot run as a page', async () => {
    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(appModule(), [], { surfaces: ['node_tab'] }));
    const r: Rig = make(kernel);
    const host: HTMLDivElement = hostOf(800, 600);
    expect(stateOf(host)).toBeUndefined();
    r.runtime.mountPage(slotsOf(host), pageOf(kernel.rel));
    await until(() => stateOf(host) === 'stopped', 4000);
    expect(host.querySelector('[data-testid="app-zone-status"]')?.textContent).toBe('Kanban cannot run as a page, so it was not started.');
    expect(r.spawned()).toBe(0);
  });
});
