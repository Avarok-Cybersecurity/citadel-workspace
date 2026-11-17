/**
 * The role new members get, as the ladder mirrors it: `RoleChange::MakeDefault` and the
 * default-aware `role_edits::delete`. Each refusal has the permitted case beside it.
 */
import { describe, expect, it } from 'vitest';
import type { RoleDefinition, WorkspaceRoles } from 'citadel-workspace-client-ts';
import { defaultRole, mayMakeDefault, mayReassignTo } from '../role-ladder';
import { ADMIN, GUEST, MEMBER, OWNER, SEED, role, tableOf, withDefault } from '@/test-utils/role-table';

const LEAD: RoleDefinition = role('role-lead', 250, ['ManageRoles', 'ViewContent', 'ViewMembers']);
const WITH_LEAD: WorkspaceRoles = tableOf(OWNER, ADMIN, LEAD, MEMBER, GUEST);

describe('defaultRole', () => {
  it('is the role the table names for new members', () => {
    expect(defaultRole(SEED)).toBe(MEMBER);
    expect(defaultRole(withDefault(SEED, 'guest'))).toBe(GUEST);
  });
  it('is null for a table naming a role it does not have', () => {
    expect(defaultRole(withDefault(SEED, 'role-gone'))).toBeNull();
  });
});

describe('mayMakeDefault', () => {
  it('allows a role below you carrying nothing you lack', () => {
    expect(mayMakeDefault(ADMIN, GUEST)).toBe(true);
    expect(mayMakeDefault(OWNER, ADMIN)).toBe(true);
    expect(mayMakeDefault(LEAD, GUEST)).toBe(true);
  });
  it('refuses the Owner, your own role or one above it, and one carrying what you lack', () => {
    expect(mayMakeDefault(OWNER, OWNER)).toBe(false);
    expect(mayMakeDefault(ADMIN, ADMIN)).toBe(false);
    expect(mayMakeDefault(LEAD, ADMIN)).toBe(false);
    expect(mayMakeDefault(LEAD, MEMBER)).toBe(false);
  });
  it('refuses anyone who may not manage roles', () => {
    expect(mayMakeDefault(MEMBER, GUEST)).toBe(false);
  });
});

describe('deleting the default', () => {
  it('cannot move its holders onto the Owner, which would become the default', () => {
    expect(mayReassignTo(SEED, OWNER, MEMBER, OWNER)).toBe(false);
    expect(mayReassignTo(SEED, OWNER, MEMBER, GUEST)).toBe(true);
    expect(mayReassignTo(SEED, OWNER, GUEST, OWNER)).toBe(true);
  });
  it('still offers only roles the actor could assign', () => {
    expect(mayReassignTo(WITH_LEAD, LEAD, MEMBER, GUEST)).toBe(true);
    expect(mayReassignTo(WITH_LEAD, LEAD, GUEST, MEMBER)).toBe(false);
  });
});
