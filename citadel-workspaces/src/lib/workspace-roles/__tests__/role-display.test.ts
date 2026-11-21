/** A badge names the role the table holds for the member's id, or their ban; a remembered name stands in only when it must. */
import { describe, expect, it } from 'vitest';
import type { WorkspaceRoles } from 'citadel-workspace-client-ts';
import { BANNED_DISPLAY, displayRole, rememberedRoleName } from '../role-display';
import { SEED, tableOf, OWNER, ADMIN, GUEST, MEMBER } from '@/test-utils/role-table';

describe('displayRole', () => {
  it('uses the table: a renamed, recoloured role shows as the admin named it', () => {
    const table: WorkspaceRoles = tableOf(OWNER, { ...ADMIN, name: 'Stewards', color: '#EF4444' }, MEMBER, GUEST);
    expect(displayRole(table, { roleId: 'admin', role: 'Admin' })).toEqual({ id: 'admin', name: 'Stewards', color: '#EF4444' });
  });
  it('falls back to the remembered name while the table is unknown, or when the id is missing from it', () => {
    expect(displayRole(null, { roleId: 'admin', role: 'Admin' })).toEqual({ id: 'admin', name: 'Admin', color: null });
    expect(displayRole(SEED, { role: 'member' })).toEqual({ id: 'member', name: 'Member', color: null });
  });
  it('shows nothing when neither is known', () => {
    expect(displayRole(SEED, {})).toBeNull();
    expect(rememberedRoleName('  ')).toBeNull();
  });
  it('shows a banned member as banned, whatever role id a stale copy names', () => {
    expect(displayRole(SEED, { roleId: 'admin', banned: true })).toEqual(BANNED_DISPLAY);
    expect(displayRole(SEED, { roleId: 'admin', banned: false })).toEqual({ id: 'admin', name: 'Admin', color: null });
  });
});
