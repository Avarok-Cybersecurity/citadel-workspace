/**
 * What the real agent sends a joiner around its `GroupRequestJoin` (topic-admission.ts): the
 * session's joined groups when asked (none yet, here), and once the owner admitted it, the group
 * channel the SDK opened, with no request id. Fake agents in the topic tests add these to their
 * per-request Success, as the agent does.
 */
export function admittedAfterJoin(variant: string, body: Readonly<Record<string, unknown>>, cid: bigint, groupKey: unknown = body.group_key): Record<string, unknown>[] {
  if (variant === 'GroupListJoined') return [{ GroupListJoinedSuccess: { cid, groups: [], request_id: body.request_id, pending_invites: [], owners: [] } }];
  return variant === 'GroupRequestJoin' ? [{ GroupChannelCreateSuccess: { cid, group_key: groupKey, request_id: null } }] : [];
}
