// @vitest-environment node
/**
 * Two windows of one member, each a page runtime binding the same glue install (glue-steps.ts
 * `bindGlue`, its ports from host-ports.ts): a write to the member's own store in one is heard in
 * the other, which reads the key again. Before, the kernel's announcements (node stores only) were
 * all a binding heard, so the other window kept showing what it had read until it was reloaded.
 * The windows share Node's real BroadcastChannel, as the page opens it (page-runtime.ts).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GlueBound, GlueTabMount } from '@/components/office/app-zone/app-zone-environment';
import { calendarPorts, type CalendarPorts } from '@/lib/calendar/ports';
import type { StorageChange } from '../../host/glue-instance';
import { appModule } from '../../host/__tests__/app-fixtures';
import { ownWrites, type OwnWrites, type OwnWritesChannel } from '../own-store-writes';
import type { RosterMember } from '../first-party-ports';
import { FakeRuntimeKernel, release, rig, rigWorld, tabOf, type Rig } from './runtime-rig';

const ANA: bigint = 7n;
const rigs: Rig[] = [];
const channels: BroadcastChannel[] = [];
afterEach(() => {
  for (const r of rigs.splice(0)) r.close();
  for (const c of channels.splice(0)) c.close();
});

function channel(): OwnWritesChannel {
  const c: BroadcastChannel = new BroadcastChannel('another-window-test');
  channels.push(c);
  return { postMessage: (m: unknown): void => c.postMessage(m), onMessage: (l: (m: unknown) => void): void => c.addEventListener('message', (e: MessageEvent<unknown>): void => l(e.data)) };
}

/** One window: its own page runtime over the shared kernel, acting for `member`. */
async function openWindow(kernel: FakeRuntimeKernel, member: bigint): Promise<CalendarPorts> {
  const own: OwnWrites = ownWrites(member, channel);
  const r: Rig = rig(kernel, { portWorld: async () => ({ ...rigWorld(kernel, new Set(), [], []), ownWrites: own }) });
  rigs.push(r);
  const tab: GlueTabMount = { ...tabOf(kernel.rel), firstParty: { tree: () => ({}), roster: (): RosterMember[] => [] } };
  const bound: GlueBound = await r.runtime.bindGlue(tab).ready;
  if (bound.kind !== 'bound') throw new Error(bound.why);
  return calendarPorts(bound.instance);
}

const settle = async (): Promise<void> => { for (let i: number = 0; i < 5; i += 1) await new Promise<void>((r) => { setTimeout(r, 0); }); };

describe("another window of the same member", () => {
  it('hears a write to the member\'s own store and reads the key again', async () => {
    const kernel: FakeRuntimeKernel = new FakeRuntimeKernel(release(appModule(), ['storage.user', 'storage.node'], { surfaces: ['node_tab'] }));
    const a: CalendarPorts = await openWindow(kernel, ANA);
    const b: CalendarPorts = await openWindow(kernel, ANA);
    const heard: StorageChange[] = [];
    b.onStorageChanged((c: StorageChange): void => { heard.push(c); });
    await a.storage.set({ kind: 'user' }, 'cal/private/a', new Uint8Array([1]));
    await a.storage.set({ kind: 'node', node: 'n1' }, 'cal/event/x', new Uint8Array([1]));
    await settle();
    expect(heard).toEqual([{ backend: 'user', key: 'cal/private/a' }]);
    expect(await b.storage.get({ kind: 'user' }, heard[0].key)).toEqual(Uint8Array.from([7]));
    expect(kernel.calls.at(-1)).toEqual({ install_id: kernel.rel.install.id, call: { Storage: { KvGet: { backend: 'user', key: 'cal/private/a' } } } });
  });
});
