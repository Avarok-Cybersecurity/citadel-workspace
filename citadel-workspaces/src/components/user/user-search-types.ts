/**
 * Types and helpers for UserSearch component.
 */


export interface UserData {
  id: string;
  displayName: string;
  avatarUrl?: string;
  email?: string;
  /** The legacy role mirror, shown only when `roleId` is unknown. */
  role?: string;
  /** Their role in the workspace's table. */
  roleId?: string;
  /** True, false, or null when nobody has said. See lib/presence.ts. */
  isOnline?: boolean | null;
  lastActive?: number;
}

export interface UserSearchProps {
  onUserSelect?: (user: UserData) => void;
  enableInvite?: boolean;
  className?: string;
  placeholder?: string;
  exclude?: string[]; // User IDs to exclude from results
  initialFocus?: boolean;
}


