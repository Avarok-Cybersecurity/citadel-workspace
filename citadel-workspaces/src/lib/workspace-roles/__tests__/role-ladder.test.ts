/**
 * The ladder, rule by rule, each with the case it allows and the case it refuses. The server's
 * rules are `role_edits` and `role_authority`; these hold the UI's mirror to them.
 *
 * Every rule is asked of positions and permissions. One case per rule renames a role so that a
 * check on the NAME would answer differently, which is what keeps the predicates name-free.
 */
import { describe, expect, it } from 'vitest';
import type { RoleDefinition, WorkspaceRoles } from 'citadel-workspace-client-ts';
import {
  actorRole, assignableRoles, coversAll, grantsPermission, isOnlyManager, managerCount, mayActOn, mayAssign, mayEdit, mayReassignTo, outranks,
} from '../role-ladder';
import { ADMIN, GUEST, MEMBER, OWNER, SEED, role, tableOf } from '@/test-utils/role-table';

/** A created role between Admin and Member that may manage roles, but holds little else. */
const LEAD: RoleDefinition = role('role-lead', 250, ['ManageRoles', 'ViewContent', 'ViewMembers', 'SendMessages']);
const WITH_LEAD: WorkspaceRoles = tableOf(OWNER, ADMIN, LEAD, MEMBER, GUEST);

describe('actorRole', () => {
  it('is the table entry the member holds', () => {
    expect(actorRole(SEED, 'member')).toBe(MEMBER);
  });
  it('is null for an id the table does not have, or none', () => {
    expect(actorRole(SEED, 'role-gone')).toBeNull();
    expect(actorRole(SEED, undefined)).toBeNull();
  });
});

describe('grantsPermission', () => {
  it('covers everything with All', () => {
    expect(grantsPermission(ADMIN, 'ConfigureSystem')).toBe(true);
  });
  it('is only what is listed otherwise: the Owner does not hold All or ConfigureSystem', () => {
    expect(grantsPermission(OWNER, 'ManageRoles')).toBe(true);
    expect(grantsPermission(OWNER, 'ConfigureSystem')).toBe(false);
    expect(grantsPermission(OWNER, 'All')).toBe(false);
  });
  it('covers a set only when every member of it is covered', () => {
    expect(coversAll(MEMBER, GUEST.permissions)).toBe(true);
    expect(coversAll(GUEST, MEMBER.permissions)).toBe(false);
  });
});

describe('outranks', () => {
  it('is strictly below for anyone but the Owner', () => {
    expect(outranks(ADMIN, MEMBER.position)).toBe(true);
    expect(outranks(ADMIN, ADMIN.position)).toBe(false);
    expect(outranks(MEMBER, ADMIN.position)).toBe(false);
  });
  it('is everything for the Owner', () => {
    expect(outranks(OWNER, OWNER.position)).toBe(true);
  });
});

describe('mayEdit', () => {
  it('allows a role below, with ManageRoles', () => {
    expect(mayEdit(ADMIN, MEMBER)).toBe(true);
    expect(mayEdit(LEAD, MEMBER)).toBe(true);
  });
  it('lets the Owner edit an Admin holding All, which the Owner does not hold', () => {
    expect(mayEdit(OWNER, ADMIN)).toBe(true);
  });
  it('refuses your own role, a role above, and the Owner role, whoever asks', () => {
    expect(mayEdit(ADMIN, ADMIN)).toBe(false);
    expect(mayEdit(LEAD, ADMIN)).toBe(false);
    expect(mayEdit(OWNER, OWNER)).toBe(false);
  });
  it('refuses without ManageRoles, whatever the role is called', () => {
    const renamed: RoleDefinition = { ...MEMBER, name: 'Admin' };
    expect(mayEdit(renamed, GUEST)).toBe(false);
  });
});

describe('mayAssign', () => {
  it('allows a role below whose permissions you hold', () => {
    expect(mayAssign(ADMIN, MEMBER, null)).toBe(true);
    expect(mayAssign(MEMBER, GUEST, null)).toBe(true);
  });
  it('refuses a role below that carries a permission you lack', () => {
    const editors: RoleDefinition = role('role-editors', 150, ['EditMdx']);
    expect(mayAssign(MEMBER, editors, null)).toBe(false);
  });
  it('refuses your own rank and above', () => {
    expect(mayAssign(ADMIN, ADMIN, new Set(['admin']))).toBe(false);
    expect(mayAssign(MEMBER, ADMIN, null)).toBe(false);
  });
  it('lets the Owner assign anything, the Owner role included', () => {
    expect(mayAssign(OWNER, OWNER, new Set(['owner']))).toBe(true);
    expect(mayAssign(OWNER, ADMIN, null)).toBe(true);
  });
  it('fills the vacant Owner seat for someone holding every Owner permission', () => {
    expect(mayAssign(ADMIN, OWNER, new Set(['admin']))).toBe(true);
  });
  it('does not fill a held seat, a seat on an unknown roster, or one for someone lacking Owner permissions', () => {
    expect(mayAssign(ADMIN, OWNER, new Set(['owner']))).toBe(false);
    expect(mayAssign(ADMIN, OWNER, null)).toBe(false);
    expect(mayAssign(LEAD, OWNER, new Set(['role-lead']))).toBe(false);
  });
  it('lists what may be assigned, and withholds nothing while you are unknown', () => {
    expect(assignableRoles(SEED, MEMBER, new Set(['owner'])).map((r: RoleDefinition): string => r.id)).toEqual(['guest']);
    expect(assignableRoles(SEED, null, null)).toEqual(SEED.roles);
  });
});

describe('mayReassignTo', () => {
  it('allows a role you may assign, other than the one going', () => {
    expect(mayReassignTo(SEED, ADMIN, MEMBER, GUEST)).toBe(true);
    expect(mayReassignTo(SEED, OWNER, ADMIN, OWNER)).toBe(true);
  });
  it('refuses the role being deleted, and one that is not below you or carries what you lack', () => {
    expect(mayReassignTo(SEED, ADMIN, MEMBER, MEMBER)).toBe(false);
    expect(mayReassignTo(WITH_LEAD, LEAD, MEMBER, ADMIN)).toBe(false);
    expect(mayReassignTo(WITH_LEAD, LEAD, GUEST, MEMBER)).toBe(false);
  });
});

describe('mayActOn', () => {
  it('allows a member below you, yourself, and anything for the Owner', () => {
    expect(mayActOn(ADMIN, MEMBER, false)).toBe(true);
    expect(mayActOn(MEMBER, MEMBER, true)).toBe(true);
    expect(mayActOn(OWNER, OWNER, false)).toBe(true);
  });
  it('treats a member with no role in the table as below everyone', () => {
    expect(mayActOn(GUEST, null, false)).toBe(true);
  });
  it('refuses a member at or above you', () => {
    expect(mayActOn(ADMIN, ADMIN, false)).toBe(false);
    expect(mayActOn(MEMBER, ADMIN, false)).toBe(false);
  });
});

describe('the last member able to manage roles', () => {
  it('counts holders of a role granting ManageRoles, All included', () => {
    expect(managerCount(WITH_LEAD, ['owner', 'role-lead', 'member', 'admin'])).toBe(3);
  });
  it('is the only manager when they grant it and nobody else does', () => {
    expect(isOnlyManager(WITH_LEAD, ['role-lead', 'member', 'guest'], 'role-lead')).toBe(true);
  });
  it('is not when another member also may, or when they cannot themselves', () => {
    expect(isOnlyManager(WITH_LEAD, ['role-lead', 'admin'], 'role-lead')).toBe(false);
    expect(isOnlyManager(WITH_LEAD, ['role-lead', 'member'], 'member')).toBe(false);
  });
  it('asks the permission, not the name: a renamed Admin still counts, a role called Admin without it does not', () => {
    const renamed: WorkspaceRoles = tableOf(OWNER, { ...ADMIN, name: 'Stewards' }, { ...MEMBER, name: 'Admin' }, GUEST);
    expect(isOnlyManager(renamed, ['admin', 'member'], 'admin')).toBe(true);
    expect(isOnlyManager(renamed, ['admin', 'member'], 'member')).toBe(false);
  });
});
