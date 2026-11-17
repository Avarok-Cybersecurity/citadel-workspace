/**
 * Converting between the backend's MessageGroupKey and the string id the UI uses.
 *
 * The backend identifies a group by `MessageGroupKey { cid: u64, mgid: u128 }`
 * (citadel_types, proto/mod.rs). The frontend threads a `groupId: string`
 * through its hooks, components and routes.
 *
 * Nothing converted between the two. GroupInvite, GroupLeave, GroupKick and
 * GroupEnd all sent `group_key: groupId` — a bare string where a struct was
 * expected — and it was invisible to tsc because `toInternalServiceRequest` is a
 * cast to InternalServiceRequest rather than a real conversion. The requests
 * could not deserialize, so none of those operations ever worked.
 *
 * One encoding, used by every send and every receive. Two of them would
 * reintroduce exactly the bug this replaces.
 */

/** The backend's group identifier. `mgid` exceeds Number.MAX_SAFE_INTEGER, so both stay bigint. */
export interface MessageGroupKey {
  cid: bigint;
  mgid: bigint;
}

const SEPARATOR: string = ':';

/**
 * `"<cid>:<mgid>"`. Chosen over JSON so the id stays usable in a route path
 * (/groups/:groupId) and as a Map key.
 */
export function groupKeyToId(key: MessageGroupKey): string {
  return `${key.cid.toString()}${SEPARATOR}${key.mgid.toString()}`;
}

/**
 * Throws on anything that is not a well-formed id.
 *
 * Deliberately not lenient: returning a zero key for unparseable input would
 * address a real-but-wrong group, and the caller is about to send an invite,
 * kick or delete with it.
 */
export function groupIdToKey(groupId: string): MessageGroupKey {
  const parts: string[] = groupId.split(SEPARATOR);
  if (parts.length !== 2) {
    throw new Error(`Malformed group id "${groupId}" — expected "<cid>:<mgid>"`);
  }

  const [rawCid, rawMgid] = parts;
  if (!/^\d+$/.test(rawCid) || !/^\d+$/.test(rawMgid)) {
    throw new Error(`Malformed group id "${groupId}" — both parts must be unsigned integers`);
  }

  return { cid: BigInt(rawCid), mgid: BigInt(rawMgid) };
}

/** Whether `groupId` round-trips, for callers that would rather branch than catch. */
export function isValidGroupId(groupId: string): boolean {
  try {
    groupIdToKey(groupId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalise a group key that arrived over the wire.
 *
 * CBOR gives bigints back, but a JSON-ish path can yield numbers or strings, and
 * a `mgid` that has been through a JS number is already corrupt — so accept the
 * widened input here rather than letting it reach `groupKeyToId` as `[object Object]`.
 */
export function parseGroupKey(raw: unknown): MessageGroupKey {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Group key is missing');
  }
  const { cid, mgid } = raw as { cid?: unknown; mgid?: unknown };
  if (cid === undefined || mgid === undefined) {
    throw new Error('Group key is missing cid or mgid');
  }
  return { cid: BigInt(cid as string | number | bigint), mgid: BigInt(mgid as string | number | bigint) };
}
