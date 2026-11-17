/**
 * Why something in a group is unavailable — a decision, or an absence.
 *
 * When the `sendMessages` and `viewMemberList` switches were wired up, the
 * denial they produced came from `useGroupPermissions`' "No role = no
 * permissions" branch. That branch answers false to two quite different
 * questions at once:
 *
 *   - you hold a role, and it does not permit this; and
 *   - you are not in this group's member list at all.
 *
 * The second happens for real. `buildGroupFromInvite` adds the accepting user
 * on a best-effort basis and its own docstring says the members array may
 * "contain only the inviter". Such a user was then told "Your role in this
 * group cannot send messages", naming a role they do not have and offering
 * nothing to do about it.
 *
 * Same shape as the presence dot one directory over: an absence rendered as a
 * decision. Four answers, so the UI can say which.
 *
 * The fourth arrived the same way the third did. `useGroupPermissions` reaches
 * a member's permissions through `roles.find(r => r.id === myMember.roleId)`,
 * and answers "no permissions" when that find comes back empty -- which is a
 * third question again:
 *
 *   - you hold a role, and it does not permit this;
 *   - you are not in this group's member list at all; and
 *   - you are listed, holding a role id that names no role we have.
 *
 * The last is not a decision anyone made about this user. Role ids are minted
 * per peer with `crypto.randomUUID()`, so an id that travelled from another
 * peer's group resolves against nothing here, and a member carrying one was
 * told "You do not have permission" -- a refusal attributed to a role that
 * does not exist. Naming it separately keeps a data fault from reading as
 * policy, and lets a log say which of the two actually happened.
 */
export type GroupRestriction =
  | 'allowed'
  | 'denied-by-role'
  | 'not-listed'
  | 'role-missing';

/**
 * `hasRole` is required rather than defaulted: the two refusals it separates
 * are indistinguishable at the call site otherwise, which is the whole bug.
 */
export function groupRestriction(
  listedAsMember: boolean,
  hasRole: boolean,
  allowed: boolean,
): GroupRestriction {
  if (allowed) return 'allowed';
  if (!listedAsMember) return 'not-listed';
  return hasRole ? 'denied-by-role' : 'role-missing';
}

/** What to tell someone who cannot do `action` here. Null when they can. */
export function restrictionText(restriction: GroupRestriction, action: string): string | null {
  switch (restriction) {
    case 'allowed':
      return null;
    case 'denied-by-role':
      return `You do not have permission to ${action} here.`;
    case 'not-listed':
      return `You are not listed as a member of this group yet, so you cannot ${action}.`;
    case 'role-missing':
      return `Your role in this group could not be found, so you cannot ${action}. Ask an admin to re-assign your role.`;
  }
}
