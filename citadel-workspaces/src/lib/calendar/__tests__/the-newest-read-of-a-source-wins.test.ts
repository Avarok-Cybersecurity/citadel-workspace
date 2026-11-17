/**
 * Two reads of one source in flight at once (a change arriving mid-read): the store keeps the
 * newest read's answer even when the older read finishes last, so a slow stale read can never
 * overwrite what a newer one found.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Capability } from '@/lib/citadel-apps/host/capabilities';
import { glueInstance, type StorageChange } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY } from '@/lib/citadel-apps/host/limits';
import type { PortAnswer, StoragePort } from '@/lib/citadel-apps/host/ports';
import type { KvPage } from '@/lib/citadel-apps/sdk/generated/KvPage';
import { ManualClock } from '@/lib/citadel-apps/host/__tests__/fakes';
import { calendarPorts } from '../ports';
import { calendarReducer, initialCalendar, type CalendarAction, type CalendarState } from '../store';
import { useCalendarSources } from '../use-calendar-sources';
import { event, realEngine } from './engine-rig';
import { MemoryStore } from './memory-store';
import type { CalendarPorts } from '@/lib/calendar/ports';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';

const engine: CalendarEngine = realEngine();

describe('reading a source twice at once', () => {
  it('keeps the newer read when the older one answers last', async () => {
    const store: MemoryStore = new MemoryStore('amy');
    const real: StoragePort = store.port();
    /** The first node read's answer, as it was when asked (no events yet), held back until released. */
    const held: (() => void)[] = [];
    let firstNodeList: boolean = true;
    const storage: StoragePort = {
      ...real,
      KvList: (args) => {
        if (typeof args.backend === 'object' && 'node' in args.backend && firstNodeList) {
          firstNodeList = false;
          const stale: PortAnswer<KvPage> = real.KvList(args) as PortAnswer<KvPage>;
          return new Promise<PortAnswer<KvPage>>((resolve) => { held.push((): void => resolve(stale)); });
        }
        return real.KvList(args);
      },
    };
    const listeners: Set<(c: StorageChange) => void> = new Set();
    const ports: CalendarPorts = calendarPorts(glueInstance({
      appId: 'net.avarok.calendar', ports: { storage }, held: new Set<Capability>(['storage.user', 'storage.node', 'storage.node.authored']),
      policy: STANDARD_HOST_POLICY, limits: { topics: null, p2p: null }, clock: new ManualClock(), pageUrl: 'https://w.example/n1',
      storageChanges: (l) => { listeners.add(l); return (): boolean => listeners.delete(l); },
    }));
    let state: CalendarState = initialCalendar('month', { y: 2024, m: 7, d: 16 });
    const dispatch = (a: CalendarAction): void => { state = calendarReducer(state, a); };
    renderHook(() => useCalendarSources(ports, engine, 'n1', dispatch));
    await waitFor(() => expect(held).toHaveLength(1));
    store.put({ node: { node_id: 'n1' } }, 'cal/event/new', engine.encodeEvent(event({ id: 'new' })));
    for (const l of listeners) l({ backend: { node: { node_id: 'n1' } }, key: 'cal/event/new' });
    await waitFor(() => expect(state.loads.get('node')).toEqual({ kind: 'ready', unreadable: 0, limitedTo: null }));
    (held[0] as () => void)();
    await new Promise<void>((done) => { setTimeout(done, 0); });
    expect([...state.entries.values()].map((e) => e.source === 'node' && e.event.id)).toEqual(['new']);
  });
});
