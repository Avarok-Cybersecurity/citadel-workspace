/**
 * An installed app's `Notify` (host-ports.ts): a worker app granted `notifications` reaches the
 * page's sink once, badged with its name and id and carrying the node it is mounted on, which the
 * host names and the app cannot; one not granted it has no notify port, and its call reaches no
 * sink. The app is a hand-built module in the production worker host (in process) that raises one
 * notification from app_init; the sink is the rig's recorder in place of the page's list.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AppInstall, Capability } from 'citadel-workspace-client-ts';
import { encodeCbor } from '../../host/cbor';
import { STANDARD_HOST_POLICY } from '../../host/limits';
import { until } from '../../host/__tests__/in-process';
import { appModule, callGroup, type AppModuleOptions } from '../../host/__tests__/app-fixtures';
import type { AppNoticeEntry } from '../first-party-ports';
import { hostPortsFor, type BoundPorts, type PortWorld } from '../host-ports';
import { InstallPlaneRegistry } from '../install-plane-registry';
import type { ToWorker } from '../../host/worker-protocol';
import { cap } from '@/test/app-manifests';
import { APP_ID, FakeRuntimeKernel, hostOf, release, rig, rigWorld, slotsOf, zoneOf, type Rig } from './runtime-rig';

let rigs: Rig[] = [];
afterEach(() => {
  rigs.forEach((r: Rig) => r.close());
  rigs = [];
  document.body.innerHTML = '';
});

const NOTIFY_ARGS: Uint8Array = encodeCbor({ title: 'Task done', body: 'ana finished the build' });
const NOTIFY_AT: number = 1024;

/** app_init raises one notification and returns 0. */
function notifyAtInit(): Uint8Array {
  const base: AppModuleOptions = { groups: ['notify'] };
  return appModule({ ...base, init: [...callGroup(base, 'notify', 1, NOTIFY_AT, NOTIFY_ARGS.byteLength), 0x41, 0x00], data: [{ offset: NOTIFY_AT, bytes: NOTIFY_ARGS }] });
}

/** The manifest asks for `notifications` either way; the install's grant is what differs. */
const ASKS: Parameters<typeof release>[2] = { capabilities: [cap('canvas'), cap('notifications')] };

const noticeOn = (nodeId: string): AppNoticeEntry => ({ from: 'Kanban', appId: APP_ID, nodeId, title: 'Task done', body: 'ana finished the build', senderLine: null });
const stateOf = (host: HTMLElement): string | undefined => host.dataset.appState;
const settle = (): Promise<void> => new Promise<void>((done) => setTimeout(done, 100));
const portReplies = (sent: readonly ToWorker[]): number => sent.filter((m: ToWorker) => m.kind === 'port_reply').length;

function make(granted: AppInstall['granted']): { kernel: FakeRuntimeKernel; r: Rig } {
  const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(notifyAtInit(), granted, ASKS));
  const r: Rig = rig(kernel);
  rigs.push(r);
  return { kernel, r };
}

function boundFor(granted: readonly Capability[]): BoundPorts {
  const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(appModule(), [...granted], ASKS));
  const { install, manifest } = zoneOf(kernel.rel);
  const world: PortWorld = { ...rigWorld(kernel, new Set<(answer: unknown) => void>(), [], []), policy: STANDARD_HOST_POLICY };
  return hostPortsFor(install, manifest.limits, 'i-1', 'workspace', null, new InstallPlaneRegistry().attach(install.id, install.app_id), world, null, { id: APP_ID, name: 'Kanban', nodeId: 'n-1' });
}

describe("a worker app's notification", () => {
  it('reaches the page once, badged with the app and carrying the node it is mounted on', async () => {
    const { kernel, r } = make(['notifications']);
    r.runtime.mount(slotsOf(hostOf(320)), zoneOf(kernel.rel));
    await until(() => r.notices.length > 0, 4000);
    await settle();
    expect(r.notices).toEqual([noticeOn('n-1')]);
    expect(portReplies(r.sent)).toBe(1);
  });

  it('is refused without the grant: no notify port, and the sink hears nothing', async () => {
    expect(boundFor([]).ports.notify).toBeUndefined();
    expect(boundFor(['notifications']).ports.notify).toBeDefined();
    const { kernel, r } = make([]);
    const host: HTMLDivElement = hostOf(320);
    r.runtime.mount(slotsOf(host), zoneOf(kernel.rel));
    await until(() => stateOf(host) === 'running', 4000);
    await settle();
    expect(r.notices).toEqual([]);
    expect(portReplies(r.sent)).toBe(0);
  });

  it('from two instances on two nodes carries each its own node', async () => {
    const { kernel, r } = make(['notifications']);
    r.runtime.mount(slotsOf(hostOf(320)), zoneOf(kernel.rel));
    r.runtime.mount(slotsOf(hostOf(320)), { ...zoneOf(kernel.rel), zoneId: 'other', nodeId: 'n-2' });
    await until(() => r.notices.length >= 2, 4000);
    await settle();
    expect([...r.notices].sort((a: AppNoticeEntry, b: AppNoticeEntry) => a.nodeId.localeCompare(b.nodeId))).toEqual([noticeOn('n-1'), noticeOn('n-2')]);
  });
});
