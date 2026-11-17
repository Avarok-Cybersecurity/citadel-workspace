/**
 * How often a repeated SyncRequest may be answered again.
 *
 * A SyncRequest is a QUERY, not a mutation: the answer is a fresh SyncResponse
 * carrying the tree. The duplicate guard in `revfs-inbound` exists to stop an
 * operation being APPLIED twice, and it re-acknowledges duplicates for exactly
 * the reason its own comment gives — "a receiver that has already applied it and
 * stays silent leaves that sender retrying for ever". SyncRequest was excluded
 * from that re-acknowledgement, because an Ack is the wrong shape for it.
 *
 * So a peer whose SyncResponse was lost re-requested with the same op id, was
 * told nothing at all, and asked again. CI shows the result: the same op id
 * arriving once a second for the whole test, every one logged "already applied"
 * and answered with silence, while the file it was syncing never appeared.
 *
 * Answering every duplicate is not the fix either — that is the flood the
 * dedupe was added for: seven SyncRequests became a hundred handled, each
 * answered with a fresh 564-byte SyncResponse on the reliable channel, starving
 * the PlaceFile and Rmdir the user had actually asked for.
 *
 * So: answer again, but at most once per peer per interval. A requester that
 * genuinely lost its response gets one within the interval and stops asking; a
 * redelivery storm costs one response per interval instead of one per arrival.
 *
 * The gate applies to REPEATS only. A first-time request is always answered --
 * gating it too would suppress a genuinely new question asked moments after an
 * earlier one, which is a different failure from the one this fixes. The fresh
 * path still records its answer (`noteSyncAnswered`), so a burst of redeliveries
 * behind it is measured from the answer they are redeliveries of.
 */

/** At most one repeat answer per peer per two seconds. */
export const SYNC_ANSWER_INTERVAL_MS: number = 2_000;

const lastAnswered: Map<string, number> = new Map<string, number>();

/**
 * Whether to answer this REPEATED SyncRequest, recording the decision.
 *
 * Keyed per peer pair: two peers re-requesting at once are two conversations,
 * and rate-limiting one because of the other would strand it.
 */
export function mayAnswerSyncAgain(key: string, now: number): boolean {
  const previous: number | undefined = lastAnswered.get(key);
  if (previous !== undefined && now - previous < SYNC_ANSWER_INTERVAL_MS) return false;
  lastAnswered.set(key, now);
  return true;
}

/**
 * Record an answer that was sent without consulting the gate.
 *
 * Without this the first repeat of a just-answered request looks like the start
 * of a fresh interval and is answered immediately, so a same-instant burst gets
 * two full trees instead of one.
 */
export function noteSyncAnswered(key: string, now: number): void {
  lastAnswered.set(key, now);
}

/** Test seam: the map outlives a module import. */
export function forgetSyncAnswers(): void {
  lastAnswered.clear();
}
