/**
 * A change to a group's settings, put where the group actually lives.
 *
 * `settings` carries the group's roles, and therefore its permissions.
 * `use-group-roles` routes creating, editing, deleting and reordering a role
 * through `onSettingsChange`, and that callback was one line of the open page's
 * state — so role definitions never reached the store the sidebar renders and
 * `persistGroups` writes, and were gone on the next load.
 *
 * The role hook already assumed otherwise: its comment reasons about "the
 * settings the store holds" when explaining why it must build new role objects
 * rather than mutating the caller's array. That precaution was being taken
 * against a store nothing was updating.
 *
 * Sibling of `rename-group.ts`, and the same argument: the page's own state is
 * not where a group's record lives.
 */
import { getGroups, updateGroups } from './group-store';
import { announceGroupState } from './announce-group-state';
import { debugLog } from '@/lib/debug-config';
import type { GroupConversation, GroupSettings } from '@/types/group';

export function applyGroupSettings(groupId: string, settings: GroupSettings): void {
  let changed: boolean = false;
  updateGroups((prev: GroupConversation[]) => {
    // A settings change for a group that is no longer in the store -- ended
    // elsewhere, or never restored -- must not resurrect it as a partial
    // record with no members and no name.
    if (!prev.some((group) => group.id === groupId)) {
      // Reported here rather than returned. The caller has nothing useful to do
      // about it -- the panel is already open on a group the store has lost --
      // and a boolean nobody reads is the shape check-success-flags-are-checked
      // exists to refuse.
      debugLog('GroupStore', `Settings change for a group the store does not have: ${groupId}`);
      return prev;
    }
    // Identity is the store's only no-op guard and `map` always allocates --
    // see mark-group-read.ts. Reference equality is the right test here: the
    // callers in use-group-roles build a new settings object for every real
    // edit, so an identical reference means nothing was edited.
    if (prev.some((group) => group.id === groupId && group.settings === settings)) return prev;
    changed = true;
    return prev.map((group) => (group.id === groupId ? { ...group, settings } : group));
  });
  // Roles are permissions; a copy only this device holds grants nothing to anyone else.
  if (changed) announceGroupState(getGroups().find((group) => group.id === groupId));
}
