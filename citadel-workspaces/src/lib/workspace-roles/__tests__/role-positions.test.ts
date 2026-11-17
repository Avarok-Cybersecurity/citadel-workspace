/**
 * A moved or new role always gets a position the server would accept: free, strictly between
 * its neighbours, below the actor, and never the Owner's.
 */
import { describe, expect, it } from 'vitest';
import type { WorkspaceRoles } from 'citadel-workspace-client-ts';
import { movedPosition, placementAbove, positionBetween } from '../role-positions';
import { ADMIN, GUEST, MEMBER, OWNER, SEED, role, tableOf } from '@/test-utils/role-table';

describe('positionBetween', () => {
  it('is the middle of two positions', () => {
    expect(positionBetween(100, 200)).toBe(150);
  });
  it('is null when there is no integer strictly between', () => {
    expect(positionBetween(100, 101)).toBeNull();
    expect(positionBetween(-1, 0)).toBeNull();
  });
});

describe('movedPosition', () => {
  it('moves a role up past its neighbour, below the next', () => {
    expect(movedPosition(SEED, ADMIN, GUEST, -1)).toBe(250);
  });
  it('moves a role down past its neighbour, above the next or the floor', () => {
    expect(movedPosition(SEED, ADMIN, MEMBER, 1)).toBe(49);
  });
  it('will not move a role up past one that is not below the actor', () => {
    expect(movedPosition(SEED, ADMIN, MEMBER, -1)).toBeNull();
  });
  it('lets the Owner move a role up past Admin, but never into its own place', () => {
    expect(movedPosition(SEED, OWNER, MEMBER, -1)).toBe(32917);
  });
  it('will not move the lowest role down, or a role into a gap with no room', () => {
    expect(movedPosition(SEED, ADMIN, GUEST, 1)).toBeNull();
    const tight: WorkspaceRoles = tableOf(OWNER, ADMIN, MEMBER, role('role-a', 199, []), role('role-b', 198, []));
    expect(movedPosition(tight, ADMIN, role('role-b', 198, []), -1)).toBeNull();
  });
});

describe('placementAbove', () => {
  it('places a new role just above the chosen one, below the next', () => {
    expect(placementAbove(SEED, ADMIN, GUEST)).toBe(150);
  });
  it('places a new role at the bottom', () => {
    expect(placementAbove(SEED, ADMIN, null)).toBe(49);
  });
  it('stops at the actor: above the role just below them is below them', () => {
    expect(placementAbove(SEED, ADMIN, MEMBER)).toBe(250);
  });
  it('refuses to place above a role that is not below the actor', () => {
    expect(placementAbove(SEED, MEMBER, ADMIN)).toBeNull();
  });
});
