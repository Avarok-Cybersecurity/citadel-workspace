/**
 * Editing a group's roles changed one component's state and nothing else.
 *
 * Same shape as the rename in round 479, one function above it in the same
 * file. `useGroupSettingsActions.onSettingsChange` is:
 *
 *   setGroup((prev) => (prev ? { ...prev, settings } : null));
 *
 * `use-group-roles` routes creating, editing, deleting and reordering a role
 * through that callback — so role DEFINITIONS, which carry the group's
 * permissions, reached the open page and never the store that
 * `persistGroups` writes. They were gone on the next load.
 *
 * The role hook already assumed otherwise. Its own comment reasons about "the
 * settings the store holds" when explaining why it must not mutate the caller's
 * array in place — a precaution taken against a store that was never being
 * updated.
 *
 * `settings` is part of `GroupConversation`, so the store is exactly where it
 * belongs.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { applyGroupSettings } from '../apply-group-settings';
import { getGroups, updateGroups } from '../group-store';
import type { GroupSettings } from '@/types/group';

const GROUP: string = '7:42';

const baseSettings: GroupSettings = {
  roles: [{ id: 'r1', name: 'Member', color: '#fff', position: 1, permissions: {}, isBuiltIn: true }],
  defaultRoleId: 'r1',
} as unknown as GroupSettings;

function seed(): void {
  updateGroups(() => ([
    { id: GROUP, name: 'g', members: [], unreadCount: 0, settings: baseSettings },
    { id: '9:99', name: 'other', members: [], unreadCount: 0, settings: baseSettings },
  ] as never));
}

describe('changing a group’s settings', () => {
  beforeEach((): void => { seed(); });

  it('reaches the store, which is what gets persisted', () => {
    const withRole: GroupSettings = {
      ...baseSettings,
      roles: [...baseSettings.roles, { id: 'r2', name: 'Moderator' } as never],
    };

    applyGroupSettings(GROUP, withRole);

    expect(getGroups().find((g) => g.id === GROUP)?.settings.roles).toHaveLength(2);
  });

  it('leaves other groups alone', () => {
    applyGroupSettings(GROUP, { ...baseSettings, defaultRoleId: 'r2' } as GroupSettings);

    expect(getGroups().find((g) => g.id === '9:99')?.settings.defaultRoleId).toBe('r1');
  });

  it('does nothing for a group the store does not have', () => {
    // A settings change for a group that has been ended elsewhere must not
    // resurrect it as a partial record.
    applyGroupSettings('does:notexist', baseSettings);

    expect(getGroups().map((g) => g.id)).toEqual([GROUP, '9:99']);
  });

  it('starts from a store that has NOT already got the change', () => {
    // Negative control on the seed: without it every assertion above would pass
    // against an implementation that does nothing.
    expect(getGroups().find((g) => g.id === GROUP)?.settings.roles).toHaveLength(1);
  });
});
