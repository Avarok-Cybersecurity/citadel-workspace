/**
 * The signed-in person's username and display name, for this tab.
 *
 * One hook so the top bar, the workspace switcher and the chat cannot disagree:
 * the tab's identity says WHO (see lib/tab-identity.ts) and the roster says what
 * they are called (see lib/roster-display-name.ts).
 */
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useTabIdentity } from '@/hooks/use-tab-identity';
import { selfDisplayName } from '@/lib/roster-display-name';
import type { TabIdentity } from '@/lib/tab-identity';

export interface SelfName {
  username: string | undefined;
  name: string | undefined;
  /** This tab's session, when the tab identity has loaded. */
  cid: bigint | undefined;
}

export function useSelfName(): SelfName {
  const { state } = useWorkspace();
  const me: TabIdentity | null = useTabIdentity();
  // The tab's identity first. The loaded user is not reset when this tab switches to an
  // account on another workspace, so read first it kept naming the previous one (measured
  // live); it counts only when it IS this tab's account.
  const current: typeof state.currentUser = state.currentUser && (!me?.username || state.currentUser.username === me.username)
    ? state.currentUser : undefined;
  const username: string | undefined = me?.username || current?.username;
  // A workspace load writes `name: fullName || username`, so after a password
  // sign-in the loaded name IS the username. That is no name at all, and read
  // first it hid the roster's; only a name that says more is kept ahead of it.
  const loaded: string | undefined = current?.name?.trim();
  const name: string | undefined = (loaded && loaded !== username ? loaded : undefined)
    || selfDisplayName(state.members, { username, fullName: me?.fullName });
  return { username, name, cid: me?.cid };
}
