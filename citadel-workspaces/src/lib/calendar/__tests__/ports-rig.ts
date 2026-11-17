/**
 * TEST RIG: the Calendar's real ports and gate over an in-memory store (memory-store.ts), signed
 * in as `me`, holding every store the Calendar reads.
 */
import type { Capability } from '@/lib/citadel-apps/host/capabilities';
import { glueInstance } from '@/lib/citadel-apps/host/glue-instance';
import { STANDARD_HOST_POLICY } from '@/lib/citadel-apps/host/limits';
import { ManualClock } from '@/lib/citadel-apps/host/__tests__/fakes';
import { calendarPorts, type CalendarPorts } from '../ports';
import { MemoryStore } from './memory-store';

const HELD: Capability[] = ['storage.user', 'storage.node', 'storage.node.authored'];

export function portsRig(me: string): { store: MemoryStore; ports: CalendarPorts } {
  const store: MemoryStore = new MemoryStore(me);
  const ports: CalendarPorts = calendarPorts(glueInstance({
    appId: 'net.avarok.calendar', ports: { storage: store.port() }, held: new Set<Capability>(HELD), policy: STANDARD_HOST_POLICY,
    limits: { topics: null, p2p: null }, clock: new ManualClock(), pageUrl: 'https://w.example/n1', storageChanges: () => () => {},
  }));
  return { store, ports };
}
