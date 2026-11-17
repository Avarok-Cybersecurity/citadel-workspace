/**
 * WASM → UI Member Mapping
 *
 * SSOT for the WASM→UI member field normalisation. The WASM `User` type
 * from the citadel bindings carries a `name` field; the UI expects
 * `username` + `displayName`. Centralising the mapping here means every
 * downstream consumer can rely on those fields existing without writing
 * its own defensive `as`-cast logic.
 *
 * Lives in its own module so `workspace-handlers.ts` stays under the
 * 250-line CI cap.
 */

import { profileFieldsFromMetadata } from '@/lib/profile-metadata';
import { avatarUrlFromMetadata } from '@/lib/avatar-url';
import { publishedAcceptsStrangers, publishedShowsOnlineStatus, showsProfileToStrangers } from '@/lib/profile-privacy';
import { wireMapEntries } from '@/lib/wire-map';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';

/** Shape emitted on `members:loaded` / `member:loaded`. */
export interface MappedMember {
  id?: string;
  username: string;
  displayName: string;
  /** The legacy mirror; only `Banned` means anything. */
  role?: string;
  /** Their role in the workspace's table: `workspace_roles[root]`. */
  roleId?: string;
  /** Visible to other members; see lib/profile-metadata.ts. */
  avatarUrl?: string;
  email?: string;
  title?: string;
  /** Published so a refused requester can be told why; see lib/profile-privacy.ts. */
  acceptsRequestsFromStrangers?: boolean;
  /** Published Online Status choice; see lib/presence.ts `shownPresence`. */
  showsOnlineStatus?: boolean;
  showProfileToStrangers: boolean;
  [k: string]: unknown;
}

/**
 * Normalise a single raw WASM member record into the fields the UI
 * expects. Invoked from both the `Members` (plural) and `Member`
 * (singular) WorkspaceProtocolResponse handlers.
 */
/** `workspace_roles[root]`, read as a wire map: it arrives as a JS Map from WASM, an object from JSON. */
export function rootRoleIdOf(workspaceRoles: unknown): string | undefined {
  if (workspaceRoles === undefined || workspaceRoles === null) return undefined;
  const entry: [string, unknown] | undefined = wireMapEntries<unknown>(workspaceRoles, 'workspace_roles')
    .find(([key]: [string, unknown]): boolean => key === WORKSPACE_ROOT_ID);
  return typeof entry?.[1] === 'string' ? entry[1] : undefined;
}

export function mapWasmMember(raw: Record<string, unknown>): MappedMember {
  const name: string | undefined = typeof raw.name === 'string' ? raw.name : undefined;
  // Accept both string and number ids: the WASM layer historically
  // emits string CIDs, but a numeric id (e.g. a user_id integer) is a
  // valid identity. Coerce to string instead of dropping it — the
  // downstream `if (!id)` guard in useMemberEventSetup would otherwise
  // silently discard the member.
  const id: string | undefined =
    typeof raw.id === 'string'
      ? raw.id
      : typeof raw.id === 'number' || typeof raw.id === 'bigint'
        ? String(raw.id)
        : undefined;
  const username: string | undefined = typeof raw.username === 'string' ? raw.username : undefined;
  const displayName: string | undefined = typeof raw.displayName === 'string' ? raw.displayName : undefined;
  const role: string | undefined = typeof raw.role === 'string' ? raw.role : undefined;

  return {
    ...raw,
    id,
    // The server keys a User by its account username (`id`); `name` is the
    // display name, which is the registered full name and not a login handle.
    // Falling back to `name` first made "Bob Brown" the username once the two
    // differed, and every self-match and P2P lookup by username then missed.
    username: username ?? id ?? name ?? '',
    displayName: displayName ?? name ?? username ?? id ?? '',
    role,
    roleId: rootRoleIdOf(raw.workspace_roles),
    avatarUrl: avatarUrlFromMetadata(raw.metadata),
    ...profileFieldsFromMetadata(raw.metadata),
    acceptsRequestsFromStrangers: publishedAcceptsStrangers(raw.metadata),
    showsOnlineStatus: publishedShowsOnlineStatus(raw.metadata),
    showProfileToStrangers: showsProfileToStrangers(raw.metadata),
  };
}
