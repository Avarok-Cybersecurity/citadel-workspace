/**
 * The app-zone runtime end to end: a release the server holds is fetched in chunks, checked
 * against the install's pinned hashes and key, started in the production worker host, and given a
 * canvas of the zone's geometry; its storage call reaches the kernel as an `AppsRequest::Call`.
 * Every refusal starts nothing (counted at the worker spawn), and closing early starts nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AppZoneHandle } from '@/components/office/app-zone/app-zone-environment';
import { STANDARD_HOST_POLICY } from '../../host/limits';
import { InstanceSlots } from '../../host/instance-slots';
import { until } from '../../host/__tests__/in-process';
import { appModule } from '../../host/__tests__/app-fixtures';
import { fakeVerifier } from '../../host/__tests__/fake-verifier';
import { pageArtifactVerifier, wasmAppSignatureCheck, type AppSignatureCheck } from '../verifier';
import { APP_ID, FakeRuntimeKernel, hostOf, slotsOf, kvAtInit, release, rig, zoneOf, type Release, type Rig } from './runtime-rig';

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

describe('an installed, granted app', () => {
  it('runs in its zone, on a canvas of the zone’s width and height at the device pixel ratio', async () => {
    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(kvAtInit(), ['storage.user']));
    const r: Rig = make(kernel);
    const host: HTMLDivElement = hostOf(320);
    r.runtime.mount(slotsOf(host), zoneOf(kernel.rel));
    expect(stateOf(host)).toBe('starting');
    expect(statusOf(host)).toBe('Starting Kanban…');
    await until(() => stateOf(host) === 'running', 4000);
    const canvas: HTMLCanvasElement = host.querySelector('canvas') as HTMLCanvasElement;
    expect([canvas.width, canvas.height, canvas.style.height, canvas.getAttribute('aria-label')]).toEqual([640, 480, '240px', 'Kanban']);
    expect((host.querySelector('[data-testid="app-zone-status"]') as HTMLElement).style.display).toBe('none');
    // The artifact came in chunks, every one asked for by the PINNED digest.
    const fetches: unknown[] = kernel.requests.filter((q) => typeof q === 'object' && 'FetchArtifact' in q);
    expect(fetches.length).toBe(Math.ceil(kernel.rel.wasm.byteLength / 100));
    expect(fetches.every((q) => (q as { FetchArtifact: { sha256: string } }).FetchArtifact.sha256 === kernel.rel.install.artifact_sha256)).toBe(true);
    expect(r.spawned()).toBe(1);
  });

  it('its granted storage call reaches the kernel as a Call for its install (control: declared, not granted, it never does)', async () => {
    const granted: FakeRuntimeKernel = new FakeRuntimeKernel(release(kvAtInit(), ['storage.user']));
    const host: HTMLDivElement = hostOf(320);
    make(granted).runtime.mount(slotsOf(host), zoneOf(granted.rel));
    await until(() => granted.calls.length === 1, 4000);
    expect(granted.calls).toEqual([{ install_id: 'inst-1', call: { Storage: { KvGet: { backend: 'user', key: 'k' } } } }]);

    const ungranted: FakeRuntimeKernel = new FakeRuntimeKernel(release(kvAtInit(), []));
    const other: HTMLDivElement = hostOf(320);
    make(ungranted).runtime.mount(slotsOf(other), zoneOf(ungranted.rel));
    await until(() => stateOf(other) === 'running', 4000);
    await new Promise<void>((done) => setTimeout(done, 100));
    expect(ungranted.calls).toEqual([]);
  });

  it('unmounting stops it and removes the canvas', async () => {
    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(appModule(), []));
    const host: HTMLDivElement = hostOf(320);
    const zone: AppZoneHandle = make(kernel).runtime.mount(slotsOf(host), zoneOf(kernel.rel));
    await until(() => stateOf(host) === 'running', 4000);
    await zone.close('unmount');
    expect(host.querySelector('canvas')).toBeNull();
    expect(stateOf(host)).toBeUndefined();
  });
});

describe('nothing starts that did not pass', () => {
  const stopped = async (rel: Release, setup: (k: FakeRuntimeKernel) => void, verifier = fakeVerifier): Promise<{ host: HTMLDivElement; r: Rig }> => {
    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(rel);
    setup(kernel);
    const r: Rig = make(kernel, {}, verifier);
    const host: HTMLDivElement = hostOf(320);
    r.runtime.mount(slotsOf(host), zoneOf(rel));
    await until(() => stateOf(host) === 'stopped', 4000);
    return { host, r };
  };

  it('a signature that does not verify', async () => {
    const rel: Release = release(appModule(), []);
    const { host, r } = await stopped({ ...rel, listing: { ...rel.listing, signature: 'ab'.repeat(32) } }, () => undefined);
    expect(statusOf(host)).toBe('Kanban did not pass its signature and hash check, so it was not started.');
    expect(r.spawned()).toBe(0);
  });

  it('bytes the server serves that are not the pinned artifact', async () => {
    const { host, r } = await stopped(release(appModule(), []), (k) => { k.served = appModule({ init: [0x41, 0x01] }); });
    expect(statusOf(host)).toBe('Kanban did not pass its signature and hash check, so it was not started.');
    expect(r.spawned()).toBe(0);
  });

  it('the page’s verifier, when its signature check cannot load, starts nothing and says so', async () => {
    const unloadable: AppSignatureCheck = wasmAppSignatureCheck(() => Promise.reject(new Error('the wasm client did not load')));
    const { host, r } = await stopped(release(appModule(), []), () => undefined, pageArtifactVerifier(globalThis.crypto.subtle, unloadable));
    expect(statusOf(host)).toBe('Kanban could not be checked on this device, so it was not started.');
    expect(r.spawned()).toBe(0);
  });

  it('a zone unmounted while its release loads starts nothing', async () => {
    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(appModule(), []));
    kernel.pause();
    const r: Rig = make(kernel);
    const host: HTMLDivElement = hostOf(320);
    const closing: Promise<void> = r.runtime.mount(slotsOf(host), zoneOf(kernel.rel)).close('unmount');
    kernel.resume();
    await closing;
    await new Promise<void>((done) => setTimeout(done, 200));
    expect(r.spawned()).toBe(0);
    expect(host.childElementCount).toBe(0);
  });

  it('a page at its instance cap says so (control: the first zone runs)', async () => {
    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(appModule(), []));
    const r: Rig = make(kernel, { slots: new InstanceSlots(1), policy: STANDARD_HOST_POLICY });
    const first: HTMLDivElement = hostOf(320);
    const second: HTMLDivElement = hostOf(320);
    r.runtime.mount(slotsOf(first), zoneOf(kernel.rel));
    await until(() => stateOf(first) === 'running', 4000);
    r.runtime.mount(slotsOf(second), zoneOf(kernel.rel));
    await until(() => stateOf(second) === 'stopped', 4000);
    expect(statusOf(second)).toBe('This page is already running as many apps as it can, so Kanban was not started.');
    expect(APP_ID).toBe(kernel.rel.install.app_id);
  });
});
