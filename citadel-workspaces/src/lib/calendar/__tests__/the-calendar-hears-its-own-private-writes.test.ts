// @vitest-environment node
/**
 * The kernel announces a write to a node's store to the node's viewers, the writer included, but
 * never a write to a member's own store (storage_notice.rs). The pane re-reads a source only when
 * a change is announced, so an event imported or saved as private was stored and never shown, and
 * another window of the same member kept showing the store as it was until it was reloaded. The
 * page's storage layer now announces each write to the member's own store, once it is written, to
 * every instance of the install for that member: in the writing window and in the others, over a
 * BroadcastChannel (own-store-writes.ts). Node stores' writes stay the kernel's to announce.
 *
 * Each window is the real glue instance and Calendar ports, bound as glue-steps.ts binds them,
 * over one in-memory server store (which announces nothing itself) and Node's real BroadcastChannel.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Capability } from '@/lib/citadel-apps/host/capabilities';
import { glueInstance, type StorageChange, type Unsubscribe } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY } from '@/lib/citadel-apps/host/limits';
import { ManualClock, oneClock } from '@/lib/citadel-apps/host/__tests__/fakes';
import { announcingStorage, ownWrites, type OwnWrites, type OwnWritesChannel } from '@/lib/citadel-apps/runtime/own-store-writes';
import { onInstallChanges } from '@/lib/citadel-apps/runtime/storage-changed';
import { calendarPorts, type CalendarPorts } from '../ports';
import { MemoryStore } from './memory-store';

const INSTALL: string = 'install-cal';
const ANA: bigint = 7n;
const BEN: bigint = 8n;
const opened: BroadcastChannel[] = [];
afterEach(() => { for (const c of opened.splice(0)) c.close(); });

/** A window's end of the browser's channel, as page-runtime.ts opens it. */
function channel(): OwnWritesChannel {
  const c: BroadcastChannel = new BroadcastChannel('own-store-writes-test');
  opened.push(c);
  return {
    postMessage: (m: unknown): void => c.postMessage(m),
    onMessage: (l: (m: unknown) => void): void => c.addEventListener('message', (e: MessageEvent<unknown>): void => l(e.data)),
  };
}

interface OpenWindow {
  readonly ports: CalendarPorts;
  readonly heard: StorageChange[];
  readonly leave: Unsubscribe;
}

/** One window of `member` (`who` in the store), with `held` granted, listening from the start. */
function openWindow(values: Map<string, Uint8Array>, member: bigint, who: string, held: Capability[] = ['storage.user', 'storage.node']): OpenWindow {
  const own: OwnWrites = ownWrites(member, channel);
  const ports: CalendarPorts = calendarPorts(glueInstance({
    appId: 'net.avarok.calendar', ports: { storage: announcingStorage(new MemoryStore(who, values).port(), INSTALL, own) }, held: new Set<Capability>(held),
    policy: STANDARD_HOST_POLICY, limits: { topics: null, p2p: null }, ...oneClock(new ManualClock()), pageUrl: 'https://w.example/n1',
    storageChanges: (l: (c: StorageChange) => void): Unsubscribe => onInstallChanges(() => () => {}, own, INSTALL, l),
  }));
  const heard: StorageChange[] = [];
  const leave: Unsubscribe = ports.onStorageChanged((c: StorageChange): void => { heard.push(c); });
  return { ports, heard, leave };
}

/** Lets the channel deliver: a BroadcastChannel message arrives on a later turn. */
const settle = async (): Promise<void> => { for (let i: number = 0; i < 5; i += 1) await new Promise<void>((r) => { setTimeout(r, 0); }); };
const bytes: Uint8Array = new Uint8Array([1]);
const user = (...keys: string[]): StorageChange[] => keys.map((key: string) => ({ backend: 'user', key }));

describe("the Calendar's writes to the member's own store", () => {
  it('are heard in the writing window once written, each key, and not after it leaves', async () => {
    const a: OpenWindow = openWindow(new Map(), ANA, 'ana');
    await a.ports.storage.set({ kind: 'user' }, 'cal/private/a', bytes);
    await a.ports.storage.setMany({ kind: 'user' }, [{ key: 'cal/private/b', value: bytes }, { key: 'cal/private/c', value: bytes }]);
    await a.ports.storage.remove({ kind: 'user' }, 'cal/private/a');
    await a.ports.storage.set({ kind: 'node', node: 'n1' }, 'cal/event/x', bytes);
    a.leave();
    await a.ports.storage.set({ kind: 'user' }, 'cal/private/d', bytes);
    expect(a.heard).toEqual(user('cal/private/a', 'cal/private/b', 'cal/private/c', 'cal/private/a'));
  });

  it("are heard in the member's other window, which reads the new value again", async () => {
    const values: Map<string, Uint8Array> = new Map();
    const a: OpenWindow = openWindow(values, ANA, 'ana');
    const b: OpenWindow = openWindow(values, ANA, 'ana');
    expect(await b.ports.storage.get({ kind: 'user' }, 'cal/private/a')).toBeNull();
    await a.ports.storage.set({ kind: 'user' }, 'cal/private/a', new Uint8Array([4, 2]));
    await a.ports.storage.remove({ kind: 'user' }, 'cal/private/gone');
    await settle();
    expect(b.heard).toEqual(user('cal/private/a', 'cal/private/gone'));
    expect(await b.ports.storage.get({ kind: 'user' }, b.heard[0].key)).toEqual(new Uint8Array([4, 2]));
  });

  it("are not heard by another member's window in the same browser, nor by another install", async () => {
    const values: Map<string, Uint8Array> = new Map();
    const a: OpenWindow = openWindow(values, ANA, 'ana');
    const ben: OpenWindow = openWindow(values, BEN, 'ben');
    const otherInstall: StorageChange[] = [];
    ownWrites(ANA, channel).listen('install-other', (c: StorageChange): void => { otherInstall.push(c); });
    await a.ports.storage.set({ kind: 'user' }, 'cal/private/a', bytes);
    await settle();
    expect(a.heard).toEqual(user('cal/private/a'));
    expect(ben.heard).toEqual([]);
    expect(otherInstall).toEqual([]);
  });

  it('are not heard when the write is refused, and node writes are left to the kernel', async () => {
    const values: Map<string, Uint8Array> = new Map();
    const a: OpenWindow = openWindow(values, ANA, 'ana', ['storage.node']);
    const b: OpenWindow = openWindow(values, ANA, 'ana');
    await expect(a.ports.storage.set({ kind: 'user' }, 'cal/private/a', bytes)).rejects.toMatchObject({ refused: 'ungranted' });
    await a.ports.storage.set({ kind: 'node', node: 'n1' }, 'cal/event/x', bytes);
    await settle();
    expect(a.heard).toEqual([]);
    expect(b.heard).toEqual([]);
  });
});
