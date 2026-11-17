/**
 * Renaming a group changed one component's state and nothing else.
 *
 * `useGroupSettingsActions.onNameChange` is the whole rename:
 *
 *   setGroup((prev) => (prev ? { ...prev, name } : null));
 *
 * That is the open page's local state. It does not reach `rememberGroupName`,
 * which is the local authority for a group's name — `group-store` builds every
 * group's label from `chosenGroupName(id) ?? …` — and it does not reach
 * `updateGroups`, which is what the sidebar renders and what gets persisted.
 *
 * So renaming a group left the sidebar showing the old name immediately, and
 * the new name disappeared entirely on the next reload. The protocol genuinely
 * has no group name to send — `GroupCreate` carries no name field, which is why
 * `group-names.ts` exists at all — so a local rename is the right behaviour.
 * It just has to be stored where "local" means.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { applyGroupRename } from '../rename-group';
import { rememberGroupName, chosenGroupName, forgetGroupNames } from '../group-names';
import { getGroups, updateGroups } from '../group-store';

const GROUP: string = '7:42';

function seed(): void {
  forgetGroupNames();
  updateGroups(() => ([
    { id: GROUP, name: 'old', members: [], unreadCount: 0 },
    { id: '9:99', name: 'other', members: [], unreadCount: 0 },
  ] as never));
}

describe('renaming a group', () => {
  beforeEach((): void => { seed(); });

  it('reaches the store the sidebar renders', () => {
    applyGroupRename(GROUP, 'new name');

    expect(getGroups().find((g) => g.id === GROUP)?.name).toBe('new name');
  });

  it('reaches the name store, so it survives a rebuild of the group record', () => {
    applyGroupRename(GROUP, 'new name');

    expect(chosenGroupName(GROUP)).toBe('new name');
  });

  it('leaves other groups alone', () => {
    applyGroupRename(GROUP, 'new name');

    expect(getGroups().find((g) => g.id === '9:99')?.name).toBe('other');
  });

  it('ignores a blank name rather than clearing the label', () => {
    // The panel trims before calling, but a group with an empty name renders as
    // a blank row that cannot be identified or clicked back to.
    applyGroupRename(GROUP, '   ');

    expect(getGroups().find((g) => g.id === GROUP)?.name).toBe('old');
    expect(chosenGroupName(GROUP)).toBeNull();
  });

  it('is what rememberGroupName already does for a newly created group', () => {
    // Negative control on the seed: without a rename, the name store is empty
    // and these assertions would pass on any implementation.
    expect(chosenGroupName(GROUP)).toBeNull();
    rememberGroupName(GROUP, 'from creation');
    expect(chosenGroupName(GROUP)).toBe('from creation');
  });
});
