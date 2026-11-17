/**
 * The one avatar colour rotation.
 *
 * There were three palettes — 7 colours in CreateGroupMembersTable, 8 in
 * GroupMemberManagementHelpers, 8 again in GroupMemberAvatars — and callers
 * picked whichever their neighbour imported. Since each rotates on
 * `index % length`, the same member came out one colour in the create-group
 * dialog and a different one in member management. Avatar colour is an identity
 * cue; a person changing colour between two screens quietly destroys it.
 *
 * Deliberately literal hex, and deliberately NOT theme tokens. These identify a
 * PERSON, not a semantic role, so they must stay stable when a workspace
 * changes its palette — the same reasoning that keeps the collaborator-cursor
 * colours literal. See docs/THEMING.md.
 *
 * Gold is gone from the rotation. It was first in two of the three lists and
 * commented "Owner", but both used it as an ordinary rotation entry, so any
 * member landing on index 0 was dressed as the owner. Role colour is an
 * explicit override, applied below, and is the only thing that should signal
 * rank.
 */
export const AVATAR_COLORS: readonly ["#6E59A5", "#4F46E5", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899"] = [
  '#6E59A5', // Purple
  '#4F46E5', // Indigo
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Violet
  '#EC4899', // Pink
] as const;

/** Stable colour for a position in a list. */
export function avatarColor(index: number): string {
  // Guards a negative or fractional index, where `%` alone would return NaN
  // and hand the caller `undefined`.
  const safe: number = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
  return AVATAR_COLORS[safe % AVATAR_COLORS.length];
}

/** As above, but an explicit role colour wins. */
export function memberAvatarColor(
  member: { role?: { color?: string } | null } | null | undefined,
  index: number,
): string {
  return member?.role?.color || avatarColor(index);
}

/**
 * Stable colour for a PERSON, derived from their username alone.
 *
 * `memberAvatarColor` rotates by list position, so it cannot give one person one
 * colour across screens. Surfaces that show a person without a list around them
 * (the collaborator cursor) use this: the same username hashes to the same index
 * in the same palette on every device, with no colour carried over the wire.
 */
export function usernameAvatarColor(username: string): string {
  let hash: number = 0;
  for (const ch of username) hash = (Math.imul(hash, 31) + (ch.codePointAt(0) ?? 0)) >>> 0;
  return avatarColor(hash);
}
