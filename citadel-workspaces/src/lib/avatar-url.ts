/**
 * Turn a user's stored avatar into something an `<img src>` can take.
 *
 * The server keeps it in `User.metadata` as
 * `MetadataValue::String(base64)`, which reaches the client as a tagged enum —
 * `{ type: "String", content: "…" }` — and older payloads have been seen as a
 * bare string and as `{ String: "…" }`. Three shapes, and until now each caller
 * unpacked them itself: `useEventEmitterSetup` handled all three,
 * `GeneralSettingsTab` handled only `.content`. Two readers of one wire format
 * drift, and the one that drifts is the one nobody is looking at.
 *
 * So the shape is known in one place, `profile-metadata.ts`, and this only
 * turns the stored base64 into a URL.
 */

import { metadataText, PROFILE_METADATA_KEYS } from './profile-metadata';

/**
 * The base64 the server stores carries no data-URL prefix, so one is added.
 * `image/webp` because `processAvatarImage` encodes WebP before upload — the
 * browser sniffs the real type anyway, but a wrong label is still a lie.
 */
const DATA_URL_PREFIX: string = 'data:image/webp;base64,';

export function avatarUrlFromMetadata(metadata: unknown): string | undefined {
  const raw: string | undefined = metadataText(metadata, PROFILE_METADATA_KEYS.avatar);
  if (raw === undefined) return undefined;

  // Already a data URL on the paths that round-trip one; do not double-prefix.
  return raw.startsWith('data:') ? raw : `${DATA_URL_PREFIX}${raw}`;
}
