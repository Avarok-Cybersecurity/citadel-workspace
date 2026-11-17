/**
 * Save sends exactly the edit: only the fields changed, Grant only what was newly ticked,
 * Revoke only what was newly unticked -- so two admins editing different fields of one role do
 * not overwrite each other. The `All` cases follow the server's `role_edits::revoke`.
 */
import { describe, expect, it } from 'vitest';
import type { Permission, RoleChange, RoleDefinition } from 'citadel-workspace-client-ts';
import { draftGrants, draftOf, roleChanges, togglePermission, type RoleDraft } from '../role-diff';
import { ADMIN, GUEST, MEMBER } from '@/test-utils/role-table';
import { ALL_PERMISSIONS } from '@/lib/permissions-service/types';

const EVERY_BUT_ALL: Permission[] = ALL_PERMISSIONS.filter((p: Permission): boolean => p !== 'All');

function edited(role: RoleDefinition, change: (draft: RoleDraft) => RoleDraft): RoleChange[] {
  return roleChanges(role, change(draftOf(role)));
}

describe('roleChanges', () => {
  it('is empty for an untouched draft', () => {
    expect(roleChanges(MEMBER, draftOf(MEMBER))).toEqual([]);
  });

  it('sends a rename alone, trimmed, and nothing for whitespace around the same name', () => {
    expect(edited(MEMBER, (d: RoleDraft): RoleDraft => ({ ...d, name: ' Crew ' }))).toEqual([{ Rename: 'Crew' }]);
    expect(edited(MEMBER, (d: RoleDraft): RoleDraft => ({ ...d, name: ' Member ' }))).toEqual([]);
  });

  it('sends a recolour alone, including clearing it', () => {
    expect(edited(MEMBER, (d: RoleDraft): RoleDraft => ({ ...d, color: '#10B981' }))).toEqual([{ Recolor: '#10B981' }]);
    expect(edited({ ...MEMBER, color: '#10B981' }, (d: RoleDraft): RoleDraft => ({ ...d, color: null }))).toEqual([{ Recolor: null }]);
  });

  it('grants only what was newly ticked and revokes only what was newly unticked', () => {
    const changes: RoleChange[] = edited(GUEST, (d: RoleDraft): RoleDraft => ({
      ...d, permissions: togglePermission(togglePermission(d.permissions, 'SendMessages', true), 'ViewMembers', false),
    }));
    expect(changes).toEqual([{ Revoke: ['ViewMembers'] }, { Grant: ['SendMessages'] }]);
  });

  it('sends nothing for a box ticked and then unticked again', () => {
    expect(edited(GUEST, (d: RoleDraft): RoleDraft => ({
      ...d, permissions: togglePermission(togglePermission(d.permissions, 'EditMdx', true), 'EditMdx', false),
    }))).toEqual([]);
  });

  it('revokes just the unticked box from a role holding All, leaving the server to spell out the rest', () => {
    expect(edited(ADMIN, (d: RoleDraft): RoleDraft => ({ ...d, permissions: togglePermission(d.permissions, 'BanUser', false) })))
      .toEqual([{ Revoke: ['BanUser'] }]);
  });

  it('revokes only the wildcard when All itself is unticked', () => {
    expect(edited(ADMIN, (d: RoleDraft): RoleDraft => ({ ...d, permissions: togglePermission(d.permissions, 'All', false) })))
      .toEqual([{ Revoke: ['All'] }]);
  });

  it('revokes before it grants, so granting All is not spelled straight back out', () => {
    const changes: RoleChange[] = edited(MEMBER, (d: RoleDraft): RoleDraft => ({
      ...d, permissions: togglePermission(togglePermission(d.permissions, 'DownloadFiles', false), 'All', true),
    }));
    expect(changes).toEqual([{ Revoke: ['DownloadFiles'] }, { Grant: ['All'] }]);
  });

  it('puts every field change in the one Update', () => {
    const changes: RoleChange[] = edited(GUEST, (d: RoleDraft): RoleDraft => ({
      name: 'Visitors', color: '#3B82F6', permissions: togglePermission(d.permissions, 'ReadMessages', true),
    }));
    expect(changes).toEqual([{ Rename: 'Visitors' }, { Recolor: '#3B82F6' }, { Grant: ['ReadMessages'] }]);
  });
});

describe('togglePermission', () => {
  it('spells the wildcard out when one covered box is unticked', () => {
    const next: Set<Permission> = togglePermission(new Set<Permission>(['All']), 'BanUser', false);
    expect(next.has('All')).toBe(false);
    expect([...next].sort()).toEqual(EVERY_BUT_ALL.filter((p: Permission): boolean => p !== 'BanUser').sort());
  });

  it('changes nothing when a box is ticked under the wildcard', () => {
    expect([...togglePermission(new Set<Permission>(['All']), 'BanUser', true)]).toEqual(['All']);
  });

  it('reads a box as granted under the wildcard', () => {
    expect(draftGrants(new Set<Permission>(['All']), 'ViewTelemetry')).toBe(true);
    expect(draftGrants(new Set<Permission>(['ViewContent']), 'ViewTelemetry')).toBe(false);
  });
});
