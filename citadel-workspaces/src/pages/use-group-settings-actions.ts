/**
 * The settings panel's three callbacks, out of `GroupChatPage` for the length
 * cap and because they are one unit: everything the panel can change about a
 * group, plus ending it.
 */
import { useCallback } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { GroupConversation, GroupSettings } from '@/types/group';
import { sendGroupEnd } from '@/lib/group-conversations/group-requests';
import { applyGroupRename } from '@/lib/group-conversations/rename-group';
import { applyGroupSettings } from '@/lib/group-conversations/apply-group-settings';
import { debugLog } from '@/lib/debug-config';

export interface GroupSettingsActions {
  onSettingsChange: (settings: GroupSettings) => void;
  onNameChange: (name: string) => Promise<void>;
  onDeleteGroup: () => Promise<void>;
}

export function useGroupSettingsActions(deps: {
  groupId: string | undefined;
  setGroup: React.Dispatch<React.SetStateAction<GroupConversation | null>>;
  navigate: NavigateFunction;
  toast: (options: { title: string; description?: string; variant?: 'destructive' }) => void;
}): GroupSettingsActions {
  const { groupId, setGroup, navigate, toast } = deps;

  const onSettingsChange: (settings: GroupSettings) => void = useCallback(
    (settings: GroupSettings): void => {
      // The store as well as this page. `settings` carries the group's roles,
      // and therefore its permissions; updating only local state meant every
      // role edit was gone on the next load, while `use-group-roles` reasoned
      // in its own comments about "the settings the store holds".
      if (groupId) applyGroupSettings(groupId, settings);
      setGroup((prev) => (prev ? { ...prev, settings } : null));
    },
    [groupId, setGroup],
  );

  const onNameChange: (name: string) => Promise<void> = useCallback(
    async (name: string): Promise<void> => {
      if (!groupId) return;
      // This used to be the setGroup line alone, which is the open page's own
      // state. The sidebar renders the group STORE and the label is rebuilt
      // from the NAME store, so a rename that touched neither left the sidebar
      // showing the old name and lost the new one on the next reload. See
      // rename-group.ts for why a rename is local in the first place.
      if (!applyGroupRename(groupId, name)) return;
      setGroup((prev) => (prev ? { ...prev, name: name.trim() } : null));
    },
    [groupId, setGroup],
  );

  const onDeleteGroup: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (!groupId) return;
    // No `currentUserId` guard. It was the page's copy of the connection CID,
    // empty in a tab that cannot resolve it, and returning on it resolved the
    // delete as though it had worked: the panel closed and nothing was sent or
    // said. `sendGroupEnd` resolves the CID itself and throws when there is
    // none, which lands in the catch below and is shown.
    try {
      // Was `const client = getClient(); if (client) { ...send... }` -- and a
      // follower tab owns no client, so the delete was skipped WITHOUT error
      // and the user was navigated away as though it had worked. The group
      // still existed, for everyone.
      await sendGroupEnd(groupId);
      navigate('/workspace');
    } catch (error) {
      debugLog('GroupChatPage', 'Failed to delete group:', error);
      toast({
        title: 'Failed to delete group',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }, [groupId, navigate, toast]);

  return { onSettingsChange, onNameChange, onDeleteGroup };
}
