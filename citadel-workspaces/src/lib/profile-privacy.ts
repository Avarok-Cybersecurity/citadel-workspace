/**
 * The privacy choices stored on the user's record on the workspace server.
 *
 * - `show_profile_to_strangers`: whether members who are not P2P contacts are
 *   sent the avatar, email and title. The SERVER enforces it
 *   (`profile_visibility.rs`); this client only reads it back and sends
 *   changes. It lives there, not in local settings, because only the party
 *   that serves the profile can withhold it.
 * - `accepts_requests_from_strangers`: a published copy of the local setting
 *   of that name, readable by other members so a requester this user's client
 *   refused can be told why. The refusal itself never consults it.
 * - `shows_online_status`: a published copy of the local Online Status
 *   setting. Presence comes from the Citadel server's peer list, which reports
 *   it to every member and knows nothing of this choice, so the only place it
 *   can be honoured is each viewer's client (`shownPresence` in presence.ts).
 *
 * Keys and the unset default mirror the kernel's `profile_update.rs` and
 * `profile_visibility.rs`; kernel test `profile_privacy_mirror.rs` pins them.
 */

export const PRIVACY_METADATA_KEYS: {
  readonly showProfileToStrangers: 'show_profile_to_strangers';
  readonly acceptsRequestsFromStrangers: 'accepts_requests_from_strangers';
  readonly showsOnlineStatus: 'shows_online_status';
} = {
  showProfileToStrangers: 'show_profile_to_strangers',
  acceptsRequestsFromStrangers: 'accepts_requests_from_strangers',
  showsOnlineStatus: 'shows_online_status',
} as const;

/** What the server does for a record that never set the choice. */
export const SHOW_PROFILE_TO_STRANGERS_WHEN_UNSET: boolean = true;

type MetadataFlag = boolean | { type?: unknown; content?: unknown; Boolean?: unknown } | null | undefined;

/** The boolean stored under `key`, or undefined when there is none. */
export function metadataFlag(metadata: unknown, key: string): boolean | undefined {
  if (metadata === null || typeof metadata !== 'object') return undefined;
  const value: MetadataFlag = (metadata as Record<string, MetadataFlag>)[key];
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return undefined;
  const raw: unknown = value.type === 'Boolean' ? value.content : value.Boolean;
  return typeof raw === 'boolean' ? raw : undefined;
}

export function showsProfileToStrangers(metadata: unknown): boolean {
  return metadataFlag(metadata, PRIVACY_METADATA_KEYS.showProfileToStrangers) ?? SHOW_PROFILE_TO_STRANGERS_WHEN_UNSET;
}

/** undefined: the member has not published a policy (every record before this existed). */
export function publishedAcceptsStrangers(metadata: unknown): boolean | undefined {
  return metadataFlag(metadata, PRIVACY_METADATA_KEYS.acceptsRequestsFromStrangers);
}

/** What an unpublished Online Status choice means: every record before it existed. */
export const SHOWS_ONLINE_STATUS_WHEN_UNSET: boolean = true;

/** undefined: the member has not published the choice (`SHOWS_ONLINE_STATUS_WHEN_UNSET`). */
export function publishedShowsOnlineStatus(metadata: unknown): boolean | undefined {
  return metadataFlag(metadata, PRIVACY_METADATA_KEYS.showsOnlineStatus);
}
