/**
 * The kernel announces a write to a node's store to the node's viewers, the writer included, but
 * never a write to a member's own store (storage_notice.rs). The pane re-reads a source only when
 * a change is announced, so an event imported or saved as private was stored and never shown. The
 * Calendar's ports now tell their own listeners what they wrote to the member's store, once it is
 * written, and only that: the node stores' writes stay the kernel's to announce.
 *
 * The real glue instance and ports over an in-memory store, which announces nothing itself.
 */
import { describe, expect, it } from 'vitest';
import type { Capability } from '@/lib/citadel-apps/host/capabilities';
import { glueInstance, type StorageChange, type Unsubscribe } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY } from '@/lib/citadel-apps/host/limits';
import { ManualClock, oneClock } from '@/lib/citadel-apps/host/__tests__/fakes';
import { calendarPorts, type CalendarPorts } from '../ports';
import { MemoryStore } from './memory-store';

function rig(held: Capability[]): CalendarPorts {
  return calendarPorts(glueInstance({
    appId: 'net.avarok.calendar', ports: { storage: new MemoryStore('ana').port() }, held: new Set<Capability>(held), policy: STANDARD_HOST_POLICY,
    limits: { topics: null, p2p: null }, ...oneClock(new ManualClock()), pageUrl: 'https://w.example/n1', storageChanges: () => () => {},
  }));
}

const bytes: Uint8Array = new Uint8Array([1]);

describe("the Calendar's own writes to the member's store", () => {
  it('are heard by its listeners once written, each key, and not after they leave', async () => {
    const ports: CalendarPorts = rig(['storage.user', 'storage.node']);
    const heard: StorageChange[] = [];
    const leave: Unsubscribe = ports.onStorageChanged((c: StorageChange): void => { heard.push(c); });
    await ports.storage.set({ kind: 'user' }, 'cal/private/a', bytes);
    await ports.storage.setMany({ kind: 'user' }, [{ key: 'cal/private/b', value: bytes }, { key: 'cal/private/c', value: bytes }]);
    await ports.storage.remove({ kind: 'user' }, 'cal/private/a');
    await ports.storage.set({ kind: 'node', node: 'n1' }, 'cal/event/x', bytes);
    leave();
    await ports.storage.set({ kind: 'user' }, 'cal/private/d', bytes);
    expect(heard).toEqual(['cal/private/a', 'cal/private/b', 'cal/private/c', 'cal/private/a'].map((key: string) => ({ backend: 'user', key })));
  });

  it('are not heard when the write is refused', async () => {
    const ports: CalendarPorts = rig(['storage.node']);
    const heard: StorageChange[] = [];
    ports.onStorageChanged((c: StorageChange): void => { heard.push(c); });
    await expect(ports.storage.set({ kind: 'user' }, 'cal/private/a', bytes)).rejects.toMatchObject({ refused: 'ungranted' });
    expect(heard).toEqual([]);
  });
});
