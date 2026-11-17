/**
 * Whether a workspace record names different members from the last one seen for it.
 *
 * The server announces a workspace record to its members whenever it changes it, including when
 * a colleague joins by connecting for the first time. The sidebar's roster is a separate request
 * (`ListMembers`) made once per domain, so without this a member already signed in never saw the
 * newcomer until a reload -- under a default trust policy that lets every colleague message every
 * other.
 *
 * Membership specifically, not "a record arrived": the same record is announced for a theme,
 * a profile edit or a trust change, and re-reading the roster for each would be a request per
 * settings click. The first record seen for a workspace is not a change: the roster is read on
 * load anyway.
 */
const lastSeen: Map<string, ReadonlySet<string>> = new Map();

export function membershipChanged(workspaceId: string, members: readonly string[]): boolean {
  const next: ReadonlySet<string> = new Set(members);
  const previous: ReadonlySet<string> | undefined = lastSeen.get(workspaceId);
  lastSeen.set(workspaceId, next);
  if (previous === undefined) return false;
  if (previous.size !== next.size) return true;
  for (const member of next) if (!previous.has(member)) return true;
  return false;
}
