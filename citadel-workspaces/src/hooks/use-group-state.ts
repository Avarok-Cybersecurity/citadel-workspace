/**
 * Group Conversations State — the React face of the shared group store.
 *
 * State and event handling live in lib/group-conversations/group-store, ONCE
 * for the whole app. This hook only subscribes. It used to own both, per
 * instance: the sidebar's copy had the groups, the group page's fresh copy had
 * none, and opening a group you were just invited to bounced you straight back
 * to the workspace with "Group not found". See the store header for why the
 * localStorage bridge between those copies never actually persisted anything.
 */

import { useState, useEffect, useMemo, useCallback, useSyncExternalStore , type Dispatch , type SetStateAction } from 'react';
import type { GroupConversation } from '@/types/group';
import {
  getGroups,
  subscribeToGroups,
  areGroupsHydrated,
  updateGroups,
  startGroupEventBindings,
  restorePersistedGroups,
} from '@/lib/group-conversations/group-store';
import { startGroupNotificationBindings } from '@/lib/group-conversations/group-notifications';
import { sessionUsername } from '@/lib/group-conversations/session-username';

export interface GroupState {
  groups: GroupConversation[];
  setGroups: React.Dispatch<React.SetStateAction<GroupConversation[]>>;
  /** False until the persisted restore has finished; see `areGroupsHydrated`. */
  hydrated: boolean;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

/**
 * Subscribes this component to the shared group list. `loading` and `error`
 * remain per-consumer: they describe a consumer's own refresh, not the list.
 */
export function useGroupState(): GroupState {
  const groups: GroupConversation[] = useSyncExternalStore(subscribeToGroups, getGroups);
  // Whether the persisted restore has finished. A consumer that looks a group
  // up before this is true has learned nothing about whether it exists.
  const hydrated: boolean = useSyncExternalStore(subscribeToGroups, areGroupsHydrated, (): boolean => false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Idempotent: the first consumer to mount arms the store's event
    // subscriptions; everyone after is a no-op.
    startGroupEventBindings(sessionUsername);
    // Beside the store's, because a group message has to do two things: move
    // the sidebar badge (the store) and interrupt someone who is elsewhere
    // (this). Only the first was ever wired.
    startGroupNotificationBindings(sessionUsername);
    // Bindings FIRST, then the restore. An invite landing while the read is in
    // flight is merged under the snapshot rather than lost behind it.
    void restorePersistedGroups();
  }, []);

  const setGroups: Dispatch<SetStateAction<GroupConversation[]>> = useCallback<React.Dispatch<React.SetStateAction<GroupConversation[]>>>(
    (action) => {
      updateGroups((prev) =>
        typeof action === 'function'
          ? (action as (p: GroupConversation[]) => GroupConversation[])(prev)
          : action,
      );
    },
    [],
  );

  return { groups, setGroups, hydrated, loading, setLoading, error, setError };
}

/**
 * Sorts groups by last message time (most recent first).
 */
export function useSortedGroups(groups: GroupConversation[]): GroupConversation[] {
  return useMemo(() => {
    return [...groups].sort((a, b) => {
      const aTime: number = a.lastMessageTime || 0;
      const bTime: number = b.lastMessageTime || 0;
      return bTime - aTime;
    });
  }, [groups]);
}
