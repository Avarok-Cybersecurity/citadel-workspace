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
 * `undefined` as the wanted domain is a subscriber with no particular domain,
 * which takes every list.
 */
export function isForDomain(
  payloadDomainId: string,
  wantedDomainId: string | undefined,
): boolean {
  if (wantedDomainId === undefined) return true;
  return payloadDomainId === wantedDomainId;
}
