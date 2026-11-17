/**
 * Reading text out of `User.metadata`.
 *
 * The server stores profile fields as `MetadataValue::String(..)`, which
 * reaches the client as a tagged enum -- `{ type: "String", content: "…" }` --
 * and older payloads have been seen as a bare string and as `{ String: "…" }`.
 * This is the one place that knows those shapes; the avatar reader and the
 * email/title reader both go through it.
 *
 * The keys mirror `profile_update.rs` in the server kernel.
 */

type MetadataText = string | { content?: unknown; String?: unknown } | undefined;

export const PROFILE_METADATA_KEYS: { readonly avatar: 'avatar'; readonly email: 'email'; readonly title: 'title' } = {
  avatar: 'avatar',
  email: 'email',
  title: 'title',
} as const;

/** The non-empty string stored under `key`, or undefined. */
export function metadataText(metadata: unknown, key: string): string | undefined {
  if (metadata === null || typeof metadata !== 'object') return undefined;
  const value: MetadataText = (metadata as Record<string, MetadataText>)[key];
  if (value === undefined || value === null) return undefined;
  const raw: unknown = typeof value === 'string' ? value : (value.content ?? value.String);
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

/** The profile fields a member's record may carry for other members to see. */
export interface MemberProfileFields {
  email?: string;
  title?: string;
}

export function profileFieldsFromMetadata(metadata: unknown): MemberProfileFields {
  return {
    email: metadataText(metadata, PROFILE_METADATA_KEYS.email),
    title: metadataText(metadata, PROFILE_METADATA_KEYS.title),
  };
}
