/**
 * CW-5 end to end on the shipped path: an app whose every event draws a `Region` (a hand-built ABI
 * module calling CanvasDraw) runs through the zone runtime and the production worker host; the
 * region crosses the worker protocol, is read again on the page, and becomes an element with its
 * role and name over the canvas; Enter on it, and a pointer click inside its rectangle, reach the
 * app as `AppEvent::Activate` with its id. The doubles are runtime-rig.ts's (a contract fake of the
 * kernel and the stand-in signature check) and a recording canvas surface (Node has no canvas).
 *
 * Negative controls (each applied, seen red, reverted): not subscribing the surface to the
 * instance's regions (mount-steps.ts) fails the role query; posting nothing on activation fails
 * both activation cases; the worker posting no `regions` message fails the role query.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, findByRole } from '@testing-library/dom';
import { appModule, callGroup, type AppModuleOptions } from '../../host/__tests__/app-fixtures';
import { until } from '../../host/__tests__/in-process';
import { recordingSurface } from '../../host/__tests__/recording-surface';
import { decodeCbor, encodeCbor, type Decoded } from '../../host/cbor';
import type { ToWorker } from '../../host/worker-protocol';
import { FakeRuntimeKernel, hostOf, release, rig, slotsOf, zoneOf, type Rig } from './runtime-rig';

let rigs: Rig[] = [];
afterEach(() => {
  rigs.forEach((r: Rig) => r.close());
  rigs = [];
  document.body.innerHTML = '';
});

const DRAW_AT: number = 1024;
const DRAW: Uint8Array = encodeCbor({ commands: [{ clear: { color: 0 } }, { region: { id: 'node-a', x: 0, y: 0, w: 16, h: 16, label: 'Ann, lead', role: 'button' } }] });

/** Every event (init among them) paints the one frame: a clear and the region over its top-left 16 px. */
function regionApp(): Uint8Array {
  const base: AppModuleOptions = { groups: ['canvas'] };
  return appModule({ ...base, event: callGroup(base, 'canvas', 2, DRAW_AT, DRAW.byteLength), data: [{ offset: DRAW_AT, bytes: DRAW }] });
}

const activations = (r: Rig): unknown[] => r.sent.flatMap((m: ToWorker): unknown[] => {
  if (m.kind !== 'event') return [];
  const d: Decoded = decodeCbor(m.event);
  return d.ok && typeof d.value === 'object' && d.value !== null && 'activate' in d.value ? [d.value] : [];
});

describe('a region the app draws', () => {
  it('is an element with its role and name on the page, and Enter or a click inside it reaches the app as Activate', async () => {
    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(regionApp(), []));
    const r: Rig = rig(kernel, {}, undefined, () => recordingSurface());
    rigs.push(r);
    const host: HTMLDivElement = hostOf(320);
    r.runtime.mount(slotsOf(host), zoneOf(kernel.rel));
    await until(() => host.dataset.appState === 'running', 4000);
    const region: HTMLElement = await findByRole(host, 'button', { name: 'Ann, lead' }, { timeout: 4000 });
    expect([region.style.left, region.style.top, region.style.width, region.style.height]).toEqual(['0px', '0px', '16px', '16px']);

    fireEvent.keyDown(region, { key: 'Enter' });
    await until(() => activations(r).length === 1, 4000);
    fireEvent.click(host.querySelector('canvas') as HTMLCanvasElement, { clientX: 8, clientY: 8 });
    await until(() => activations(r).length === 2, 4000);
    expect(activations(r)).toEqual([{ activate: { id: 'node-a' } }, { activate: { id: 'node-a' } }]);
  });
});
