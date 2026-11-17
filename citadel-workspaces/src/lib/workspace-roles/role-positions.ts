/**
 * Where a role may be placed: a free position strictly between two neighbours, below the actor.
 *
 * Positions are unique and run 0..65534; 65535 is the Owner's alone. The server refuses a
 * position at or above the actor's own (the Owner excepted) and one another role holds, so these
 * only ever propose a position it would accept, or null when there is no room.
 */
import type { RoleDefinition, WorkspaceRoles } from 'citadel-workspace-client-ts';
import { isOwnerRole } from './role-ladder';

/** The Owner's position; no other role may hold it. */
export const OWNER_POSITION: number = 65535;

/** The highest position `actor` may place a role at, plus one: an exclusive ceiling. */
function ceilingFor(actor: RoleDefinition): number {
  return isOwnerRole(actor) ? OWNER_POSITION : actor.position;
}

/** An integer strictly between `low` and `high`, or null when they are adjacent. */
export function positionBetween(low: number, high: number): number | null {
  const middle: number = Math.floor((low + high) / 2);
  return middle > low && middle < high ? middle : null;
}

function sorted(table: WorkspaceRoles): RoleDefinition[] {
  return [...table.roles].sort((a: RoleDefinition, b: RoleDefinition): number => b.position - a.position);
}

/**
 * Where `role` goes when moved one place up (`direction` -1) or down (+1), or null.
 *
 * Up: between the role above it and the one above that, never reaching the actor. Down:
 * between the role below it and the one below that.
 */
export function movedPosition(
  table: WorkspaceRoles,
  actor: RoleDefinition,
  role: RoleDefinition,
  direction: -1 | 1,
): number | null {
  const ladder: RoleDefinition[] = sorted(table);
  const at: number = ladder.findIndex((r: RoleDefinition): boolean => r.id === role.id);
  if (at < 0) return null;
  const ceiling: number = ceilingFor(actor);
  if (direction === -1) {
    const above: RoleDefinition | undefined = ladder[at - 1];
    if (above === undefined) return null;
    // Clamped to the ceiling: past a role at or above the actor, there is no room left.
    const high: number = Math.min(ladder[at - 2]?.position ?? OWNER_POSITION, ceiling);
    return positionBetween(above.position, high);
  }
  const below: RoleDefinition | undefined = ladder[at + 1];
  if (below === undefined) return null;
  return positionBetween(ladder[at + 2]?.position ?? -1, below.position);
}

/** A new role's position just above `anchor`, or at the bottom when `anchor` is null. */
export function placementAbove(table: WorkspaceRoles, actor: RoleDefinition, anchor: RoleDefinition | null): number | null {
  const ladder: RoleDefinition[] = sorted(table);
  const ceiling: number = ceilingFor(actor);
  if (anchor === null) {
    // The actor's own role is in the table, so the lowest role is never above them.
    const lowest: RoleDefinition | undefined = ladder[ladder.length - 1];
    return positionBetween(-1, lowest?.position ?? ceiling);
  }
  // Clamped to the ceiling, an anchor at or above the actor leaves no room above it.
  const at: number = ladder.findIndex((r: RoleDefinition): boolean => r.id === anchor.id);
  const high: number = Math.min(ladder[at - 1]?.position ?? OWNER_POSITION, ceiling);
  return positionBetween(anchor.position, high);
}
