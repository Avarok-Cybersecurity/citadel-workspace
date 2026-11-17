/**
 * Reading what propagation brings to a node (design 3.5, C7), through the Calendar's ports.
 *
 * - **Inherited**: the projections ancestors' publishers wrote here (`cal/inherit/<origin>/<id>`),
 *   each reconciled by the core with what this reader can read of its origin. An origin the
 *   kernel will not let the reader see leaves the projection shown without a link; a cancelled or
 *   deleted origin hides it; a newer origin is shown by its own projection until the publisher's
 *   next save rewrites the stale one.
 * - **Up-pulled**: the official and member-posted events of the pages below (at most the core's
 *   bound of them) whose `up_to` reaches this node, as the core's `shownUpAt` decides.
 *
 * A value the core cannot decode is left out and counted, as read-sources.ts does.
 */
import type { AuthoredKey } from '@/lib/citadel-apps/sdk/generated/AuthoredKey';
import type { CalendarEngine } from './engine/calendar-engine';
import type { Event } from './generated/Event';
import type { OriginRead } from './generated/OriginRead';
import type { Projection } from './generated/Projection';
import type { Reconciled } from './generated/Reconciled';
import { PortRefused, type CalendarPorts } from './ports';
import { EVENT_PREFIX } from './read-sources';
import { entryKey, type CalendarEntry, type InheritedEntry } from './store';

export const INHERIT_PREFIX: string = 'cal/inherit/';

export interface PropagatedRead {
  readonly entries: CalendarEntry[];
  readonly unreadable: number;
  /** More pages lie below than the core's bound reads from. */
  readonly truncated: boolean;
}

/** `cal/inherit/<origin>/<id>` as its parts, or null for a key of another shape. */
export function inheritedKeyParts(key: string): { origin: string; id: string } | null {
  if (!key.startsWith(INHERIT_PREFIX)) return null;
  const rest: string[] = key.slice(INHERIT_PREFIX.length).split('/');
  if (rest.length !== 2 || rest[0] === '' || rest[1] === '') return null;
  return { origin: rest[0] as string, id: rest[1] as string };
}

function decoded<T>(decode: () => T): T | null {
  try {
    return decode();
  } catch {
    return null;
  }
}

/** What this reader can read of the origin; null when it is there and the core cannot decode it. */
async function originOf(ports: CalendarPorts, engine: CalendarEngine, origin: string, id: string): Promise<OriginRead | null> {
  let bytes: Uint8Array | null;
  try {
    bytes = await ports.storage.get({ kind: 'node', node: origin }, `${EVENT_PREFIX}${id}`);
  } catch (error: unknown) {
    if (error instanceof PortRefused) return 'unreadable';
    throw error;
  }
  if (bytes === null) return 'gone';
  const event: Event | null = decoded(() => engine.decodeEvent(bytes));
  return event === null ? null : { found: { event } };
}

export async function readInherited(ports: CalendarPorts, engine: CalendarEngine, node: string): Promise<PropagatedRead> {
  const keys: string[] = await ports.storage.keys({ kind: 'node', node }, INHERIT_PREFIX);
  const entries: InheritedEntry[] = [];
  let unreadable: number = 0;
  for (const key of keys) {
    const parts: { origin: string; id: string; } | null = inheritedKeyParts(key);
    const bytes: Uint8Array | null = await ports.storage.get({ kind: 'node', node }, key);
    if (bytes === null) continue;
    const projection: Projection | null = parts === null ? null : decoded(() => engine.decodeProjection(bytes));
    if (parts === null || projection === null || projection.origin_node !== parts.origin) {
      unreadable += 1;
      continue;
    }
    const origin: OriginRead | null = await originOf(ports, engine, parts.origin, parts.id);
    if (origin === null) {
      unreadable += 1;
      continue;
    }
    const verdict: Reconciled = engine.reconcile(projection, origin);
    if (verdict === 'hide') continue;
    const shown: Projection = verdict === 'stale' && typeof origin === 'object' ? engine.project(origin.found.event) : projection;
    entries.push({ key: entryKey('inherited', node, null, key), source: 'inherited', projection: shown, linked: verdict !== 'show_without_link' });
  }
  return { entries, unreadable, truncated: false };
}

async function eventsAt(ports: CalendarPorts, below: string): Promise<{ author: string | null; key: string }[]> {
  const official: string[] = await ports.storage.keys({ kind: 'node', node: below }, EVENT_PREFIX);
  const authored: AuthoredKey[] = await ports.storage.authoredKeys(below, EVENT_PREFIX);
  return [...official.map((key: string) => ({ author: null, key })), ...authored.map((k) => ({ author: k.author, key: k.key }))];
}

/** `chain`: this node, then its ancestors. `below`: its descendants, as tree-walk.ts reads them. */
export async function readUpPulled(ports: CalendarPorts, engine: CalendarEngine, chain: readonly string[], below: readonly string[]): Promise<PropagatedRead> {
  const node: string | undefined = chain[0];
  if (node === undefined) throw new Error('an up-pull needs the node it reads for');
  const { targets, truncated } = engine.upPullTargets([...below]);
  const entries: CalendarEntry[] = [];
  let unreadable: number = 0;
  for (const target of targets) {
    for (const { author, key } of await eventsAt(ports, target)) {
      const bytes: Uint8Array | null = await ports.storage.get(author === null ? { kind: 'node', node: target } : { kind: 'authored', node: target, author }, key);
      if (bytes === null) continue;
      const event: Event | null = decoded(() => engine.decodeEvent(bytes));
      if (event === null) {
        unreadable += 1;
        continue;
      }
      if (engine.shownUpAt(event, [...chain])) entries.push({ key: entryKey('up_pulled', target, author, key), source: 'up_pulled', event });
    }
  }
  return { entries, unreadable, truncated };
}
