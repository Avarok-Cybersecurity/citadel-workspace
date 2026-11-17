/**
 * Whether a member list is the one this subscriber asked for.
 *
 * The workspace protocol carries no request id, so a `Members` response could
 * not be attributed to the request that caused it. Four subscribers each
 * accepted any list that arrived and took last-writer-wins: the sidebar, the
 * admin members tab, the user-search corpus, and the group-call roster. A list
 * fetched for one domain rendered inside another — and the admin tab would then
 * send role changes and removals naming ITS entity, with users taken from
 * somebody else's list.
 *
 * The response now names its domain. This is the check, in one place, because
 * four copies of a filter is how three of them come to differ.
 *
 * `undefined` on either side means "cannot tell": an older server that does not
 * send the field, or a subscriber with no particular domain. Accepting in that
 * case keeps the previous behaviour rather than emptying every list against a
 * server that predates the fix — a filter that silently discards everything is
 * worse than the ambiguity it replaces.
 */
export function isForDomain(
  payloadDomainId: string | undefined,
  wantedDomainId: string | undefined,
): boolean {
  if (payloadDomainId === undefined || wantedDomainId === undefined) return true;
  return payloadDomainId === wantedDomainId;
}
