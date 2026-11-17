/** A badge names the role the table holds for the member's id; the legacy mirror only stands in when it must. */
import { describe, expect, it } from 'vitest';
import type { WorkspaceRoles } from 'citadel-workspace-client-ts';
import { displayRole, legacyRoleName } from '../role-display';
import { SEED, tableOf, OWNER, ADMIN, GUEST, MEMBER } from '@/test-utils/role-table';

describe('displayRole', () => {
  it('uses the table: a renamed, recoloured role shows as the admin named it', () => {
    const table: WorkspaceRoles = tableOf(OWNER, { ...ADMIN, name: 'Stewards', color: '#EF4444' }, MEMBER, GUEST);
    expect(displayRole(table, 'admin', 'Admin')).toEqual({ id: 'admin', name: 'Stewards', color: '#EF4444' });
  });
  it('falls back to the mirror while the table is unknown, or when the id is missing from it', () => {
    expect(displayRole(null, 'admin', 'Admin')).toEqual({ id: 'admin', name: 'Admin', color: null });
    expect(displayRole(SEED, undefined, 'member')).toEqual({ id: 'member', name: 'Member', color: null });
  });
  it('shows nothing when neither is known', () => {
    expect(displayRole(SEED, undefined, undefined)).toBeNull();
  });
  it('reads a legacy custom role by its name', () => {
    expect(legacyRoleName({ Custom: ['Reviewers', 3] })).toBe('Reviewers');
    expect(legacyRoleName('  ')).toBeNull();
  });
});
