/**
 * What the role editor lets the reader change: the Owner's column never, roles at or above
 * their own never, nothing without Manage roles, and -- in a column they may edit -- a tick only
 * for a permission they hold, while an untick is always allowed.
 */
import { describe, expect, it } from 'vitest';
import type { Permission, RoleDefinition } from 'citadel-workspace-client-ts';
import { ACTOR_UNKNOWN, NEEDS_MANAGE_ROLES, NOT_BELOW_YOU, OWNER_FIXED, cellState, columnLock } from '../editor-rules';
import { ADMIN, GUEST, MEMBER, OWNER, role } from '@/test-utils/role-table';

const LEAD: RoleDefinition = role('role-lead', 250, ['ManageRoles', 'ViewContent', 'ViewMembers', 'SendMessages']);
const held = (r: RoleDefinition): Set<Permission> => new Set(r.permissions);

describe('columnLock', () => {
  it('locks the Owner column for everyone, the Owner included', () => {
    expect(columnLock(OWNER, OWNER)).toBe(OWNER_FIXED);
    expect(columnLock(ADMIN, OWNER)).toBe(OWNER_FIXED);
  });
  it('locks your own role and roles above it', () => {
    expect(columnLock(ADMIN, ADMIN)).toBe(NOT_BELOW_YOU);
    expect(columnLock(LEAD, ADMIN)).toBe(NOT_BELOW_YOU);
  });
  it('locks every column for someone without Manage roles', () => {
    expect(columnLock(MEMBER, GUEST)).toBe(NEEDS_MANAGE_ROLES);
  });
  it('locks while your own role is not yet known, and says so', () => {
    expect(columnLock(null, GUEST)).toBe(ACTOR_UNKNOWN);
  });
  it('opens a role below you when you may manage roles', () => {
    expect(columnLock(ADMIN, MEMBER)).toBeNull();
    expect(columnLock(OWNER, ADMIN)).toBeNull();
    expect(columnLock(LEAD, MEMBER)).toBeNull();
  });
});

describe('cellState', () => {
  it('lets a lead tick only what they hold themselves', () => {
    expect(cellState(LEAD, GUEST, held(GUEST), 'SendMessages')).toEqual({ checked: false, editable: true });
    expect(cellState(LEAD, GUEST, held(GUEST), 'EditMdx')).toEqual({ checked: false, editable: false });
  });
  it('always lets a ticked box be unticked, even one the editor does not hold', () => {
    expect(cellState(LEAD, MEMBER, held(MEMBER), 'DownloadFiles')).toEqual({ checked: true, editable: true });
  });
  it('never lets the Owner grant All or ConfigureSystem, which the Owner does not hold', () => {
    expect(cellState(OWNER, ADMIN, new Set<Permission>([]), 'All').editable).toBe(false);
    expect(cellState(OWNER, MEMBER, held(MEMBER), 'ConfigureSystem').editable).toBe(false);
  });
  it('shows what a locked column grants without offering a change', () => {
    expect(cellState(ADMIN, OWNER, held(OWNER), 'ManageRoles')).toEqual({ checked: true, editable: false });
    expect(cellState(MEMBER, GUEST, held(GUEST), 'ViewContent')).toEqual({ checked: true, editable: false });
  });
});
