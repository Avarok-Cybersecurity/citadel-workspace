/**
 * Reading a source through the real ports, gate and core over an in-memory store: every event of
 * the node, of every author and of the member's own private store comes back as an entry keyed by
 * where it was read; a value the core cannot decode is left out and counted; and a change is
 * mapped to the one source it touches on this node, or none.
 */
import { describe, expect, it } from 'vitest';
import type { Capability } from '@/lib/citadel-apps/host/capabilities';
import { glueInstance } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY } from '@/lib/citadel-apps/host/limits';
import { ManualClock } from '@/lib/citadel-apps/host/__tests__/fakes';
import { calendarPorts, type CalendarPorts } from '../ports';
import { readSource, sourceOfChange } from '../read-sources';
import { entryKey } from '../store';
import { event, realEngine } from './engine-rig';
import { MemoryStore } from './memory-store';
import type { SourceRead } from '@/lib/calendar/read-sources';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const engine: CalendarEngine = realEngine();
const HELD: Capability[] = ['storage.user', 'storage.node', 'storage.node.authored'];

function rig(me: string): { store: MemoryStore; ports: CalendarPorts } {
  const store: MemoryStore = new MemoryStore(me);
  const ports: CalendarPorts = calendarPorts(glueInstance({
    appId: 'net.avarok.calendar', ports: { storage: store.port() }, held: new Set<Capability>(HELD), policy: STANDARD_HOST_POLICY,
    limits: { topics: null, p2p: null }, clock: new ManualClock(), pageUrl: 'https://w.example/n1', storageChanges: () => () => {},
  }));
  return { store, ports };
}

describe('reading a source', () => {
  it("reads every one of the node's events across pages", async () => {
    const { store, ports } = rig('amy');
    for (const id of ['a', 'b', 'c']) store.put({ node: { node_id: 'n1' } }, `cal/event/${id}`, engine.encodeEvent(event({ id, title: `T${id}` })));
    store.put({ node: { node_id: 'n2' } }, 'cal/event/elsewhere', engine.encodeEvent(event({ id: 'elsewhere' })));
    const read: SourceRead = await readSource(ports, engine, 'node', 'n1');
    expect(read.unreadable).toBe(0);
    expect(read.entries.map((e) => e.key)).toEqual(['a', 'b', 'c'].map((id) => entryKey('node', 'n1', null, `cal/event/${id}`)));
  });

  it('reads what every author posted, each under its author', async () => {
    const amy: { store: MemoryStore; ports: CalendarPorts; } = rig('amy');
    amy.store.put({ node_authored: { node_id: 'n1', author: null } }, 'cal/event/x', engine.encodeEvent(event({ id: 'x', author: 'amy' })));
    amy.store.values.set(amy.store.where({ node_authored: { node_id: 'n1', author: 'bob' } }, 'cal/event/y', false), engine.encodeEvent(event({ id: 'y', author: 'bob' })));
    const read: SourceRead = await readSource(amy.ports, engine, 'authored', 'n1');
    expect(read.entries.map((e) => e.key)).toEqual([entryKey('authored', 'n1', 'amy', 'cal/event/x'), entryKey('authored', 'n1', 'bob', 'cal/event/y')]);
  });

  it('leaves out a value it cannot decode and says how many, showing the rest', async () => {
    const { store, ports } = rig('amy');
    store.put('user', 'cal/private/ok', engine.encodeEvent(event({ id: 'ok' })));
    store.put('user', 'cal/private/junk', new Uint8Array([0xff, 0x00, 0x13]));
    const read: SourceRead = await readSource(ports, engine, 'private', 'n1');
    expect(read.unreadable).toBe(1);
    expect(read.entries.map((e) => e.source === 'private' && e.event.id)).toEqual(['ok']);
  });
});

describe('which source a change touches', () => {
  it('maps a change to its source on this node only', () => {
    expect(sourceOfChange({ backend: { node: { node_id: 'n1' } }, key: 'cal/event/a' }, 'n1')).toBe('node');
    expect(sourceOfChange({ backend: { node_authored: { node_id: 'n1', author: 'bob' } }, key: 'cal/event/a' }, 'n1')).toBe('authored');
    expect(sourceOfChange({ backend: 'user', key: 'cal/private/a' }, 'n1')).toBe('private');
    expect(sourceOfChange({ backend: { node: { node_id: 'n2' } }, key: 'cal/event/a' }, 'n1')).toBeNull();
    expect(sourceOfChange({ backend: 'user', key: 'cal/settings' }, 'n1')).toBeNull();
    expect(sourceOfChange({ backend: { node: { node_id: 'n1' } }, key: 'cal/type/t' }, 'n1')).toBeNull();
    expect(sourceOfChange({ backend: 'blob', key: 'cal/event/a' }, 'n1')).toBeNull();
  });
});
