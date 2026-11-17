/**
 * Reading what one source holds, through the Calendar's ports (ports.ts), as store entries
 * (store.ts): the node's official events, the events members posted on it, and the member's own
 * private events. Inherited projections and up-pulled events are read with their propagation
 * (C7). A value the core cannot decode is not shown and is counted, so one bad value a member
 * posted cannot hide everyone else's events, and the pane says how many it left out.
 *
 * Which source a StorageChanged event touches is decided here too, so the mount re-reads exactly
 * that source and nothing else.
 */
import type { StorageChange } from '@/lib/citadel-apps/host/glue-instance';
import type { CalendarEngine } from './engine/calendar-engine';
import type { Event } from './generated/Event';
import type { CalendarPorts, CalendarStore } from './ports';
import { entryKey, type CalendarEntry, type EntrySource, type EventEntry } from './store';
import type { AuthoredKey } from '@/lib/citadel-apps/sdk/generated/AuthoredKey';

/** Where events live in each store (design 3.3.2). */
export const EVENT_PREFIX: string = 'cal/event/';
export const PRIVATE_PREFIX: string = 'cal/private/';

export type ReadSource = Extract<EntrySource, 'node' | 'authored' | 'private'>;

export interface SourceRead {
  readonly entries: CalendarEntry[];
  /** Values under the source's prefix the core could not decode. */
  readonly unreadable: number;
}

interface Located {
  readonly store: CalendarStore;
  readonly author: string | null;
  readonly key: string;
}

async function decodeAll(ports: CalendarPorts, engine: CalendarEngine, source: ReadSource, node: string, found: readonly Located[]): Promise<SourceRead> {
  const values: (Uint8Array | null)[] = await Promise.all(found.map((f: Located) => ports.storage.get(f.store, f.key)));
  const entries: EventEntry[] = [];
  let unreadable: number = 0;
  found.forEach((f: Located, i: number): void => {
    const bytes: Uint8Array | null = values[i] ?? null;
    // A key listed and gone by the time it was read was deleted between the two calls.
    if (bytes === null) return;
    let event: Event;
    try {
      event = engine.decodeEvent(bytes);
    } catch {
      unreadable += 1;
      return;
    }
    entries.push({ key: entryKey(source, node, f.author, f.key), source, event });
  });
  return { entries, unreadable };
}

export async function readSource(ports: CalendarPorts, engine: CalendarEngine, source: ReadSource, node: string): Promise<SourceRead> {
  if (source === 'authored') {
    const keys: AuthoredKey[] = await ports.storage.authoredKeys(node, EVENT_PREFIX);
    return decodeAll(ports, engine, source, node, keys.map((k) => ({ store: { kind: 'authored', node, author: k.author }, author: k.author, key: k.key })));
  }
  const store: CalendarStore = source === 'node' ? { kind: 'node', node } : { kind: 'user' };
  const keys: string[] = await ports.storage.keys(store, source === 'node' ? EVENT_PREFIX : PRIVATE_PREFIX);
  return decodeAll(ports, engine, source, node, keys.map((key: string) => ({ store, author: null, key })));
}

/** The source a change re-reads on `node`, or null when it is not one this pane shows. */
export function sourceOfChange(change: StorageChange, node: string): ReadSource | null {
  const { backend, key } = change;
  if (backend === 'user') return key.startsWith(PRIVATE_PREFIX) ? 'private' : null;
  if (typeof backend !== 'object') return null;
  if ('node' in backend) return backend.node.node_id === node && key.startsWith(EVENT_PREFIX) ? 'node' : null;
  if ('node_authored' in backend) return backend.node_authored.node_id === node && key.startsWith(EVENT_PREFIX) ? 'authored' : null;
  return null;
}
