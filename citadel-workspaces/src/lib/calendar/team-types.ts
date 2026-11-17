/**
 * A node's team event types (design §3.3.2): `cal/type/<id>` in the node's own store, which only
 * its `EditMdx` holders write (the kernel is the guard) and every viewer reads. A team type names
 * its hosts: a collective's or a round robin's. A one-on-one, group or poll type is a member's own
 * and lives on their booking page (booking-pages.ts) instead.
 */
import type { CalendarEngine } from './engine/calendar-engine';
import type { EventType } from './generated/EventType';
import { TYPE_PREFIX } from './booking-pages';
import type { CalendarPorts, CalendarStore } from './ports';

const nodeStore = (node: string): CalendarStore => ({ kind: 'node', node });

/** The hosts of a team type, or null for a member's own kind. */
export function teamHosts(type: EventType): string[] | null {
  if (typeof type.kind !== 'object') return null;
  if ('collective' in type.kind) return type.kind.collective.hosts;
  if ('round_robin' in type.kind) return type.kind.round_robin.hosts;
  return null;
}

export interface TeamTypes {
  readonly types: EventType[];
  /** Values that would not decode, or that are not a team kind: left out and counted. */
  readonly unreadable: number;
}

export async function readTeamTypes(ports: CalendarPorts, engine: CalendarEngine, node: string): Promise<TeamTypes> {
  const keys: string[] = await ports.storage.keys(nodeStore(node), TYPE_PREFIX);
  const values: (Uint8Array | null)[] = await Promise.all(keys.map((key: string) => ports.storage.get(nodeStore(node), key)));
  const types: EventType[] = [];
  let unreadable: number = 0;
  for (const bytes of values) {
    if (bytes === null) continue;
    try {
      const type: EventType = engine.decodeEventType(bytes);
      if (teamHosts(type) === null) unreadable += 1;
      else types.push(type);
    } catch {
      unreadable += 1;
    }
  }
  types.sort((a: EventType, b: EventType): number => a.name.localeCompare(b.name));
  return { types, unreadable };
}

/** The node's team types that `host` is one of the hosts of: what their instance answers claims for. */
export const typesHostedBy = (team: TeamTypes, host: string): EventType[] => team.types.filter((t: EventType) => teamHosts(t)?.includes(host) === true);

export function saveTeamType(ports: CalendarPorts, engine: CalendarEngine, node: string, type: EventType): Promise<void> {
  if (teamHosts(type) === null) throw new Error(`${type.name} is not a team type`);
  return ports.storage.set(nodeStore(node), `${TYPE_PREFIX}${type.id}`, engine.encodeEventType(type));
}

export const removeTeamType = (ports: CalendarPorts, node: string, typeId: string): Promise<void> =>
  ports.storage.remove(nodeStore(node), `${TYPE_PREFIX}${typeId}`);
