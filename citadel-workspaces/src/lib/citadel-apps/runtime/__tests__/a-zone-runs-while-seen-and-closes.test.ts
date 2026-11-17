/**
 * A mounted zone's lifecycle end to end, in the production runtime and worker host: input and
 * frames flow only while the zone and the page are seen (the app is suspended otherwise), and
 * closing it, from the zone or from the page going away, closes the app gracefully, once:
 * watchers and frames stop, the worker is terminated, the canvas goes, one audit line is written.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AppZoneHandle } from '@/components/office/app-zone/app-zone-environment';
import { encodeCbor } from '../../host/cbor';
import { until } from '../../host/__tests__/in-process';
import { appModule, callGroup, type AppModuleOptions } from '../../host/__tests__/app-fixtures';
import type { FrameLoop } from '../zone-input';
import { FakeRuntimeKernel, hostOf, slotsOf, release, rig, zoneOf, type Rig } from './runtime-rig';

const ON: Uint8Array = encodeCbor({ on: true });
const ON_AT: number = 1024;
const REQUEST_FRAMES: number = 2;

/** app_init asks for frames (events.RequestFrames {on: true}) and returns 0. */
function wantsFrames(): Uint8Array {
  const base: AppModuleOptions = { groups: ['events'] };
  return appModule({ ...base, init: [...callGroup(base, 'events', REQUEST_FRAMES, ON_AT, ON.byteLength), 0x41, 0x00], data: [{ offset: ON_AT, bytes: ON }] });
}

let rigs: Rig[] = [];
afterEach(() => {
  rigs.forEach((r: Rig) => r.close());
  rigs = [];
  document.body.innerHTML = '';
});

interface Started { readonly r: Rig; readonly host: HTMLDivElement; readonly zone: AppZoneHandle; readonly loops: () => number }

async function started(): Promise<Started> {
  let loops: number = 0;
  const frames: FrameLoop = (): (() => void) => {
    loops++;
    return (): void => { loops--; };
  };
  const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(wantsFrames(), []));
  const r: Rig = rig(kernel, { frames });
  rigs.push(r);
  const host: HTMLDivElement = hostOf(320);
  const zone: AppZoneHandle = r.runtime.mount(slotsOf(host), zoneOf(kernel.rel));
  await until(() => host.dataset.appState === 'running' && loops === 1, 4000);
  return { r, host, zone, loops: () => loops };
}

describe('a zone runs only while it is seen', () => {
  it('scrolled away, in a background tab, or kept for back/forward: no frames; seen again: frames again', async () => {
    const { r, loops } = await started();
    const away: [() => void, () => void][] = [
      [(): void => r.watch.scroll(false), (): void => r.watch.scroll(true)],
      [(): void => r.watch.tab(false), (): void => r.watch.tab(true)],
      [(): void => r.watch.page('kept'), (): void => r.watch.page('shown')],
    ];
    for (const [hide, show] of away) {
      hide();
      expect(loops()).toBe(0);
      show();
      expect(loops()).toBe(1);
    }
    // The page's reason outranks the zone's: back in view, still in a background tab, still suspended.
    r.watch.tab(false);
    r.watch.scroll(false);
    r.watch.scroll(true);
    expect(loops()).toBe(0);
  });
});

describe('a zone closes once, and completely', () => {
  it('closing stops frames and watchers, terminates the worker, removes the canvas and audits one settled close', async () => {
    const { r, host, zone, loops } = await started();
    const first: Promise<void> = zone.close('unmount');
    expect(zone.close('uninstall')).toBe(first);
    await first;
    expect([loops(), r.watch.attached(), r.terminated(), host.querySelector('canvas')]).toEqual([0, 0, 1, null]);
    expect(r.audits).toMatchObject([{ reason: 'unmount', ending: 'settled', closeResult: 0, withdrawal: 'never-served', zoneId: 'board' }]);
    expect(r.reports).toEqual([]);
    // Observations after the close reach nothing.
    r.watch.scroll(true);
    expect(loops()).toBe(0);
  });

  it('the page going away closes it as a host shutdown, and the zone’s own close after is the same close', async () => {
    const { r, zone } = await started();
    r.watch.page('leaving');
    await until(() => r.audits.length === 1, 4000);
    await zone.close('unmount');
    expect(r.audits.map((a) => [a.reason, a.ending])).toEqual([['host_shutdown', 'settled']]);
    expect(r.terminated()).toBe(1);
  });

  it('closed while its release still loads: nothing starts, and the close is audited as never started', async () => {
    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(wantsFrames(), []));
    kernel.pause();
    const r: Rig = rig(kernel);
    rigs.push(r);
    const closing: Promise<void> = r.runtime.mount(slotsOf(hostOf(320)), zoneOf(kernel.rel)).close('unmount');
    kernel.resume();
    await closing;
    await new Promise<void>((done) => setTimeout(done, 100));
    expect([r.spawned(), r.audits.map((a) => [a.ending, a.withdrawal])]).toEqual([0, [['not-started', 'not-started']]]);
  });
});
