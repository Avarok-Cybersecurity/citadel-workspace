/**
 * Reading one variant out of a group wire message.
 *
 * Extracted from group-events.ts at the repo's 250-line cap. These three are
 * the shared vocabulary every branch of that translator speaks: which variant a
 * message is, and which CIDs it names. Keeping them together means a change to
 * how a cid is parsed applies to every branch at once, rather than to whichever
 * one the author was looking at.
 */
export function variant(message: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  const value: unknown = message[name];
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/**
 * The member CIDs a MemberStateChanged variant carries.
 *
 * The wire shape is citadel_types' `MemberState::EnteredGroup { cids }` /
 * `LeftGroup { cids }` — a LIST of members, and the notification's own `cid`
 * field is the RECIPIENT's session, not the member who moved. The first cut
 * of this mapping looked for `Joined`/`Left`/`Kicked` variants and read the
 * member from that recipient field: shapes that do not exist on the wire read
 * through a field that means someone else, so no membership change was ever
 * applied and a creator's roster stayed just themselves forever.
 */
export function toCid(raw: unknown): bigint | null {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    return BigInt(raw as string | number | bigint);
  } catch {
    return null;
  }
}

export function memberCids(state: Record<string, unknown>, key: 'EnteredGroup' | 'LeftGroup'): bigint[] {
  const inner: Record<string, unknown> | undefined = variant(state, key);
  if (!inner || !Array.isArray(inner.cids)) return [];
  const cids: bigint[] = [];
  for (const raw of inner.cids) {
    try {
      cids.push(BigInt(raw as string | number | bigint));
    } catch {
      // A cid that does not parse identifies nobody; dropping it beats
      // fabricating a member out of garbage.
    }
  }
  return cids;
}

