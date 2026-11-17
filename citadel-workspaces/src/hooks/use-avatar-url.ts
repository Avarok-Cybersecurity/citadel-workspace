/**
 * The one answer to "what picture does this person have?".
 *
 * Every avatar in the app -- the sidebar members, the full member list, the messages pane --
 * resolves through here, so a picture set in profile settings appears everywhere at once. The
 * data lives in one place, the workspace state: `currentUser` for the person using the app (the
 * profile update is its only writer, and the top bar already reads it) and the member roster for
 * everyone else. Components never carry a picture of their own; they name the person and ask.
 */
import { useMemo } from 'react';
import { useWorkspace, type WorkspaceState } from '@/contexts/WorkspaceContext';

/** Pure: the picture for `username`, from the workspace state. */
export function avatarUrlFor(state: Pick<WorkspaceState, 'currentUser' | 'members'>, username: string | undefined): string | undefined {
  if (!username) return undefined;
  const members: WorkspaceState['members'] = state.members ?? {};
  const fromRoster: string | undefined =
    members[username]?.avatarUrl ?? Object.values(members).find((m) => m.username === username)?.avatarUrl;
  // Self first: the profile update writes `currentUser` before any roster refresh reaches the
  // member list, so it is the freshest copy of the user's own picture.
  if (state.currentUser?.username === username) return state.currentUser.avatarUrl ?? fromRoster;
  return fromRoster;
}

export function useAvatarUrl(username: string | undefined): string | undefined {
  const { state } = useWorkspace();
  return useMemo(() => avatarUrlFor(state, username), [state, username]);
}
